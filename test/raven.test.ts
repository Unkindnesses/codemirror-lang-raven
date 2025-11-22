import { StringStream } from "@codemirror/language"
import { describe, expect, it } from "vitest"

import { ravenParser, type RavenState } from "../src/index.js"

type Token = { text: string; style: string | null }

function tokens(doc: string): Token[] {
  const state: RavenState = ravenParser.startState
    ? ravenParser.startState(2)
    : {
      string: null,
      exprStart: true,
      macroEligible: true,
      afterDot: false,
      inSwap: false,
      macroLocked: false,
      macroLockStack: [],
    }
  const result: Token[] = []
  for (const line of doc.split(/\r?\n/)) {
    if (line === "" && ravenParser.blankLine) {
      ravenParser.blankLine(state, 2)
      continue
    }
    const stream = new StringStream(line, 4, 2)
    while (!stream.eol()) {
      const style = ravenParser.token(stream, state)
      result.push({ text: stream.current(), style })
      stream.start = stream.pos
    }
  }
  return result.filter(token => token.style)
}

function styleFor(doc: string, text: string) {
  return tokens(doc).find(token => token.text === text)?.style
}

describe("raven stream mode", () => {
  it("recognizes syntax heads as keywords", () => {
    const body = "fn foo() { return -1 }"
    expect(styleFor(body, "fn")).toBe("keyword")
    expect(styleFor(body, "return")).toBe("keyword")
    expect(styleFor(body, "foo")).toBe("variableName")
    expect(styleFor(body, "-1")).toBe("number")
  })

  it("distinguishes calls from syntax keywords", () => {
    expect(styleFor("foo(bar)", "foo")).toBe("variableName")
    expect(styleFor("foo bar", "foo")).toBe("keyword")
    expect(styleFor("foo = 1", "foo")).toBe("variableName")
  })

  it("treats loop iterables as variables", () => {
    const doc = `for x = xs {\n  total = total + x\n}`
    const xsTokens = tokens(doc).filter(token => token.text === "xs")
    expect(xsTokens.length).toBe(1)
    expect(xsTokens[0]?.style).toBe("variableName")
  })

  it("handles tags, raw strings, and extensible delimiters", () => {
    const regex = "r`\\d`"
    const escaped = '\\\\\\\\\"newline: \\\\n\"\\\\\\\\'
    const doc = `tag"foo" ${regex} ${escaped} tail`
    const parts = tokens(doc)
    if (process.env.DEBUG_TOKENS) console.log(parts)
    expect(parts.find(t => t.text === "tag")?.style).toBe("variableName")
    expect(parts.find(t => t.text.includes("`\\d`"))?.style).toBe("string")
    expect(parts.find(t => t.text === escaped)?.style).toBe("string")
    expect(parts.find(t => t.text === "tail")?.style).toBe("variableName")
  })

  it("highlights annotations, comments, and swap references", () => {
    const doc = "@label outer\nwhile true { swap(&x, &y) } # trailing"
    if (process.env.DEBUG_TOKENS) console.log(tokens(doc))
    expect(styleFor(doc, "@label")).toBe("annotation")
    expect(styleFor(doc, "outer")).toBe("variableName")
    expect(styleFor(doc, "while")).toBe("keyword")
    expect(styleFor(doc, "swap")).toBe("variableName")
    expect(styleFor(doc, "&")).toBe("operator")
    expect(styleFor(doc, "x")).toBe("variableName.special")
    expect(styleFor(doc, "y")).toBe("variableName.special")
    expect(tokens(doc).find(t => t.text.startsWith("#"))?.style).toBe("comment")
  })
})
