import { LanguageSupport, StreamLanguage, StreamParser, StringStream } from "@codemirror/language"
import { tags as t } from "@lezer/highlight"

type Quote = '"' | "`"

interface StringState {
  quote: Quote
  slashes: number
  raw: boolean
  close: string
  escape: string | null
}

export interface RavenState {
  string: StringState | null
  exprStart: boolean
  macroEligible: boolean
  afterDot: boolean
  inSwap: boolean
  macroLocked: boolean
  macroLockStack: boolean[]
}

const identifierStart = /[A-Za-z_]/
const identifierPart = /[A-Za-z0-9_!?]/
const operatorChars = /=|!|<|>|\+|-|\*|\/|\^|:|&|\|/
const delimiters = new Set(["(", ")", "[", "]", "{", "}"])
const statementTerminators = new Set([",", ")", "]", "}", "#"])
const multiCharOps = ["..."] as const
const pairedOps = ["==", "!=", ">=", "<=", "&&", "||", "|>"] as const
const singleOps = ["=", "+", "-", "*", "/", "^", ">", "<", ":", "&", "|"] as const

function peekNonSpace(stream: StringStream): { ch: string | undefined; pos: number } {
  for (let i = stream.pos; i < stream.string.length; i++) {
    const ch = stream.string[i]
    if (ch === " " || ch === "\t" || ch === "\r") continue
    if (ch === "#") return { ch: undefined, pos: i }
    return { ch, pos: i }
  }
  return { ch: undefined, pos: stream.string.length }
}

function isStringStart(source: string): boolean {
  return /^(\\*)(["`])/.test(source)
}

function startString(stream: StringStream, state: RavenState): StringState | null {
  const match = stream.match(/(\\*)(["`])/, true)
  if (!match || match === true) return null
  const slashes = match[1].length
  const quote = match[2] as Quote
  const raw = quote === "`"
  const close = quote + "\\".repeat(slashes)
  const escape = raw ? null : "\\".repeat(Math.max(1, slashes))
  const next: StringState = { quote, slashes, raw, close, escape }
  state.string = next
  state.exprStart = false
  state.macroEligible = false
  state.afterDot = false
  state.inSwap = false
  return next
}

function readString(stream: StringStream, state: RavenState): string {
  const info = state.string!
  while (!stream.eol()) {
    if (stream.match(info.close)) {
      state.string = null
      state.exprStart = false
      state.macroEligible = false
      return "string"
    }
    if (!info.raw && info.escape && stream.match(info.escape)) {
      if (!stream.eol()) stream.next()
      continue
    }
    stream.next()
  }
  return "string"
}

function readNumber(stream: StringStream, state: RavenState): string | null {
  if (stream.match(/0x[0-9a-fA-F]+/)) {
    state.exprStart = false
    state.macroEligible = false
    state.afterDot = false
    state.inSwap = false
    return "number"
  }
  if (state.exprStart && stream.match(/-\d+(?:\.\d*)?/)) {
    state.exprStart = false
    state.macroEligible = false
    state.afterDot = false
    state.inSwap = false
    return "number"
  }
  if (stream.match(/\d+(?:\.\d*)?/)) {
    state.exprStart = false
    state.macroEligible = false
    state.afterDot = false
    state.inSwap = false
    return "number"
  }
  if (state.exprStart && stream.match(/\.\d+/)) {
    state.exprStart = false
    state.macroEligible = false
    state.afterDot = false
    state.inSwap = false
    return "number"
  }
  return null
}

function isArgStart(stream: StringStream, next: { ch: string | undefined; pos: number }) {
  const { ch, pos } = next
  if (!ch) return false
  if (identifierStart.test(ch) || /\d/.test(ch)) return true
  if (ch === "." && /\d/.test(stream.string[pos + 1] ?? "")) return true
  if (ch === "(" || ch === "[" || ch === "{" || ch === "@") return true
  if (ch === '"' || ch === "`") return true
  if (ch === "\\") return isStringStart(stream.string.slice(pos))
  if (ch === "&") return true
  if (ch === "-" && /\d/.test(stream.string[pos + 1] ?? "")) return true
  return false
}

function shouldKeyword(stream: StringStream, state: RavenState): boolean {
  if (!state.exprStart || !state.macroEligible || state.afterDot || state.inSwap || state.macroLocked) return false
  const immediate = stream.peek()
  if (immediate === "(" || immediate === "[" || immediate === ".") return false
  if (immediate !== undefined && isStringStart(stream.string.slice(stream.pos))) return false
  const next = peekNonSpace(stream)
  if (next.ch === undefined || statementTerminators.has(next.ch)) return false
  return isArgStart(stream, next)
}

export const ravenParser: StreamParser<RavenState> = {
  name: "raven",
  startState(): RavenState {
    return {
      string: null,
      exprStart: true,
      macroEligible: true,
      afterDot: false,
      inSwap: false,
      macroLocked: false,
      macroLockStack: [],
    }
  },
  blankLine(state) {
    state.exprStart = true
    state.macroEligible = true
    state.afterDot = false
    state.inSwap = false
    state.macroLocked = false
  },
  token(stream, state) {
    if (state.string) return readString(stream, state)
    if (stream.sol()) {
      state.exprStart = true
      state.macroEligible = true
      state.afterDot = false
      state.inSwap = false
      state.macroLocked = false
    }
    if (stream.eatSpace()) return null
    const number = readNumber(stream, state)
    if (number) return number
    const string = startString(stream, state)
    if (string) return readString(stream, state)

    const ch = stream.peek()
    if (!ch) return null
    if (ch === "#") {
      stream.skipToEnd()
      state.exprStart = true
      state.macroEligible = true
      state.afterDot = false
      state.inSwap = false
      state.macroLocked = false
      return "comment"
    }
    if (ch === ",") {
      stream.next()
      state.exprStart = true
      state.macroEligible = true
      state.afterDot = false
      state.inSwap = false
      state.macroLocked = false
      return "punctuation"
    }
    if (delimiters.has(ch)) {
      stream.next()
      const open = ch === "(" || ch === "[" || ch === "{"
      if (open) {
        state.macroLockStack.push(state.macroLocked)
        state.macroLocked = false
      } else {
        state.macroLocked = state.macroLockStack.pop() ?? false
      }
      state.exprStart = open
      state.macroEligible = open
      state.afterDot = false
      state.inSwap = false
      return "bracket"
    }
    if (ch === "@") {
      stream.next()
      stream.eatWhile(identifierPart)
      state.exprStart = true
      state.macroEligible = false
      state.afterDot = false
      state.inSwap = false
      return "annotation"
    }
    for (const op of multiCharOps) {
      if (stream.match(op)) {
        state.exprStart = false
        state.macroEligible = false
        state.afterDot = false
        state.inSwap = false
        return "operator"
      }
    }
    for (const op of pairedOps) {
      if (stream.match(op)) {
        state.exprStart = true
        state.macroEligible = true
        state.afterDot = false
        state.inSwap = false
        return "operator"
      }
    }
    if (ch === "&") {
      stream.next()
      if (stream.peek() !== "&" && stream.peek() !== undefined && identifierStart.test(stream.peek()!)) {
        state.inSwap = true
      } else {
        state.exprStart = true
        state.macroEligible = true
      }
      state.afterDot = false
      return "operator"
    }
    for (const op of singleOps) {
      if (stream.match(op)) {
        state.exprStart = true
        state.macroEligible = true
        state.afterDot = false
        state.inSwap = false
        return "operator"
      }
    }
    if (ch === ".") {
      stream.next()
      if (stream.peek() === ".") {
        state.exprStart = false
        state.macroEligible = false
        state.afterDot = false
        state.inSwap = false
        return "operator"
      }
      state.afterDot = true
      state.exprStart = false
      state.macroEligible = false
      state.inSwap = false
      return "punctuation"
    }
    if (identifierStart.test(ch)) {
      stream.next()
      stream.eatWhile(identifierPart)
      const style = shouldKeyword(stream, state)
        ? "keyword"
        : state.afterDot
          ? "propertyName"
          : state.inSwap
            ? "variableName.special"
            : "variableName"
      if (style === "keyword") {
        state.exprStart = true
        state.macroEligible = false
        state.macroLocked = true
      } else {
        state.exprStart = false
        state.macroEligible = false
      }
      state.afterDot = false
      state.inSwap = false
      return style
    }
    if (operatorChars.test(ch)) {
      stream.next()
      state.exprStart = true
      state.macroEligible = true
      state.afterDot = false
      state.inSwap = false
      return "operator"
    }
    stream.next()
    state.exprStart = false
    state.macroEligible = false
    state.afterDot = false
    state.inSwap = false
    return null
  },
  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "[", "{", '"', "`"] },
  },
  tokenTable: {
    annotation: [t.annotation, t.meta],
  },
}

export const ravenLanguage = StreamLanguage.define(ravenParser)

export function raven() {
  return new LanguageSupport(ravenLanguage)
}
