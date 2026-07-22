import { highlightTree, tagHighlighter, tags } from "@lezer/highlight"
import { describe, expect, it } from "vitest"
import { parser, raven, ravenLanguage } from "../src/index.js"

interface Highlight {
  text: string
  classes: string
}

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: "keyword" },
  { tag: tags.variableName, class: "variable" },
  { tag: tags.operator, class: "operator" },
  { tag: tags.string, class: "string" },
  { tag: tags.number, class: "number" },
  { tag: tags.lineComment, class: "comment" }
])

function highlights(source: string): Highlight[] {
  const result: Highlight[] = []
  highlightTree(parser.parse(source), highlighter, (from, to, classes) => {
    result.push({ text: source.slice(from, to), classes })
  })
  return result
}

function highlighted(source: string, className: string): string[] {
  return highlights(source)
    .filter(({ classes }) => classes.split(" ").includes(className))
    .map(({ text }) => text)
}

function errors(source: string): number {
  let result = 0
  parser.parse(source).iterate({ enter: node => { if (node.type.isError) result++ } })
  return result
}

describe("syntax heads", () => {
  it("highlights arbitrary syntax heads rather than a fixed keyword list", () => {
    const source = "fn foo(x) { custom x { return x } }"
    expect(highlighted(source, "keyword")).toEqual(["fn", "custom", "return"])
  })

  it("distinguishes calls and templates from whitespace-separated syntax", () => {
    expect(highlighted("foo(bar)", "keyword")).toEqual([])
    expect(highlighted("foo (bar)", "keyword")).toEqual(["foo"])
    expect(highlighted('tag"body"', "keyword")).toEqual([])
    expect(highlighted('tag "body"', "keyword")).toEqual(["tag"])
  })

  it("finds syntax heads on the correct side of operators", () => {
    expect(highlighted("x + y z", "keyword")).toEqual(["y"])
    expect(highlighted("x y + z", "keyword")).toEqual(["x"])
  })

  it("keeps continuation operands out of syntax-head position", () => {
    const source = "total = first + # continuation\n  second -\n  third"
    expect(errors(source)).toBe(0)
    expect(highlighted(source, "keyword")).toEqual([])
    expect(highlighted(source, "operator")).toEqual(["=", "+", "-"])
  })

  it("distinguishes prefix, infix, and symbolic-head uses of operators", () => {
    expect(highlighted("left - right", "keyword")).toEqual([])
    expect(highlighted("left & right", "keyword")).toEqual([])
    expect(highlighted("-value", "keyword")).toEqual([])
    expect(highlighted("&value", "keyword")).toEqual([])
    expect(highlighted("- value", "keyword")).toEqual(["-"])
    expect(highlighted("& value", "keyword")).toEqual(["&"])
    expect(highlighted("if !nil?(value) { value }", "keyword")).toEqual(["if"])
  })

  it("does not mistake syntax arguments for heads", () => {
    const source = "if condition { value } else { fallback }"
    expect(highlighted(source, "keyword")).toEqual(["if"])
    expect(highlighted(source, "variable")).toContain("else")
  })

  it("styles symbolic syntax heads as keywords", () => {
    expect(highlighted("== value", "keyword")).toEqual(["=="])
    expect(highlighted("== value", "operator")).toEqual([])
  })
})

describe("parser fidelity", () => {
  it("parses representative Raven syntax without recovery", () => {
    const source = `
@doc """
  A function.
  """
fn transform(&items: List, f) {
  result = []
  for item = items {
    if !nil?(item) {
      append(&result, f(item) ...)
    } else { continue }
  }
  return result
}
`
    expect(errors(source)).toBe(0)
  })

  it("supports Raven's extended and triple-quoted string delimiters", () => {
    const sources = [
      String.raw`\\"a quote " and newline \\n"\\`,
      String.raw`\\"""contains """ triple quotes"""\\`,
      '"""js\n  console.log("hello")\n  """',
      "`raw \\n text`"
    ]
    for (const source of sources) {
      expect(errors(source), source).toBe(0)
      expect(highlighted(source, "string")).toEqual([source])
    }
  })

  it("handles literals, comments, splats, fields, and operator continuations", () => {
    const source = `
values = [0xCAFE_BABE, 1_000.25_5, .5]
next = values ...
field = object."unusual field"
total = first + # continuation
  second -
  third
`
    expect(errors(source)).toBe(0)
    expect(highlighted(source, "number")).toEqual(["0xCAFE_BABE", "1_000.25_5", ".5"])
    expect(highlighted(source, "comment")).toEqual(["# continuation"])
  })

  it("accepts operator symbols as values", () => {
    expect(errors("export { ==, !=, !, +, -, *, /, &, | }")).toBe(0)
  })
})

describe("language support", () => {
  it("exports a configured Raven language extension", () => {
    expect(ravenLanguage.name).toBe("raven")
    expect(raven().extension).toBeTruthy()
  })
})
