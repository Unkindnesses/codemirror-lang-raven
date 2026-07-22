import { ExternalTokenizer } from "@lezer/lr"
import {
  CallOpenParen, CloseBracket, CloseParen, FieldDot, HeadOperator,
  IndexOpenBracket, OpenBracket, OpenParen, Operator, PrefixOperator,
  String as StringToken, TemplateString
} from "./parser.terms.js"

export { delimiterToken, operatorToken, stringToken }

const code = (char: string) => char.charCodeAt(0)
const chars = {
  eof: -1,
  tab: code("\t"),
  newline: code("\n"),
  carriageReturn: code("\r"),
  space: code(" "),
  bang: code("!"),
  doubleQuote: code('"'),
  openParen: code("("),
  closeParen: code(")"),
  comma: code(","),
  dot: code("."),
  zero: code("0"),
  nine: code("9"),
  question: code("?"),
  upperA: code("A"),
  upperZ: code("Z"),
  openBracket: code("["),
  backslash: code("\\"),
  closeBracket: code("]"),
  underscore: code("_"),
  backtick: code("`"),
  lowerA: code("a"),
  lowerZ: code("z"),
  closeBrace: code("}")
}
const operators = new Set([
  "=", "==", "!=", "+", "-", "*", "/", "^", ">", "<", ">=", "<=", ":", "&",
  "|", "|>", "&&", "||"
])
const prefixOperators = "!-&"

function between(value: number, from: number, to: number): boolean {
  return value >= from && value <= to
}

function isIdentifierPart(value: number): boolean {
  return between(value, chars.zero, chars.nine) || between(value, chars.upperA, chars.upperZ) ||
    value === chars.underscore || between(value, chars.lowerA, chars.lowerZ) ||
    value === chars.bang || value === chars.question
}

function isHorizontalSpace(value: number): boolean {
  return value === chars.tab || value === chars.carriageReturn || value === chars.space
}

function isTerminator(value: number): boolean {
  return value === chars.eof || value === chars.newline || value === chars.closeParen ||
    value === chars.comma || value === chars.closeBracket || value === chars.closeBrace
}

const stringToken = new ExternalTokenizer((input, stack) => {
  // Extended strings close with the same number of slashes used to open them.
  let slashes = 0
  while (input.peek(slashes) === chars.backslash) slashes++
  const quoteCode = input.peek(slashes)
  if (quoteCode !== chars.doubleQuote && quoteCode !== chars.backtick) return

  const triple = input.peek(slashes + 1) === quoteCode && input.peek(slashes + 2) === quoteCode
  const quoteCount = triple ? 3 : 1
  let offset = slashes + quoteCount
  const escapeLength = quoteCode === chars.backtick ? 0 : Math.max(1, slashes)

  while (input.peek(offset) !== chars.eof) {
    let closes = true
    for (let i = 0; i < quoteCount; i++)
      closes &&= input.peek(offset + i) === quoteCode
    for (let i = 0; i < slashes; i++)
      closes &&= input.peek(offset + quoteCount + i) === chars.backslash
    if (closes) {
      offset += quoteCount + slashes
      break
    }
    if (escapeLength) {
      let escapes = true
      for (let i = 0; i < escapeLength; i++)
        escapes &&= input.peek(offset + i) === chars.backslash
      if (escapes) offset += escapeLength
    }
    if (input.peek(offset) !== chars.eof) offset++
  }

  const previous = input.peek(-1)
  const template = stack.canShift(TemplateString) && isIdentifierPart(previous)
  input.acceptToken(template ? TemplateString : StringToken, offset)
})

const delimiterToken = new ExternalTokenizer((input, stack) => {
  // Postfix delimiters must be adjacent. With whitespace, they start syntax arguments.
  const previous = input.peek(-1)
  const adjacent = previous !== chars.eof && !isHorizontalSpace(previous) && previous !== chars.newline
  switch (input.next) {
    case chars.openParen:
      input.acceptToken(adjacent && stack.canShift(CallOpenParen) ? CallOpenParen : OpenParen, 1)
      break
    case chars.closeParen: input.acceptToken(CloseParen, 1); break
    case chars.openBracket:
      input.acceptToken(adjacent && stack.canShift(IndexOpenBracket) ? IndexOpenBracket : OpenBracket, 1)
      break
    case chars.closeBracket: input.acceptToken(CloseBracket, 1); break
    case chars.dot:
      if (input.peek(1) !== chars.dot && adjacent && stack.canShift(FieldDot)) input.acceptToken(FieldDot, 1)
  }
}, { contextual: true })

const operatorToken = new ExternalTokenizer((input, stack) => {
  let value = ""
  for (let offset = 0; "=!+-*/^><:&|".includes(String.fromCharCode(input.peek(offset))); offset++)
    value += String.fromCharCode(input.peek(offset))
  if (!value) return

  if (value !== "!=" && value[0] === "!") {
    const next = input.peek(1)
    input.acceptToken(isHorizontalSpace(next) || isTerminator(next) ? HeadOperator : PrefixOperator, 1)
    return
  }

  if (stack.canShift(Operator)) {
    if (operators.has(value)) input.acceptToken(Operator, value.length)
    return
  }

  const first = value[0]
  if (prefixOperators.includes(first)) {
    const next = input.peek(1)
    input.acceptToken(isHorizontalSpace(next) || isTerminator(next) ? HeadOperator : PrefixOperator, 1)
  } else if (operators.has(value)) input.acceptToken(HeadOperator, value.length)
}, { contextual: true })
