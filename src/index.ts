import {
  delimitedIndent, foldInside, foldNodeProp, indentNodeProp, LanguageSupport,
  LRLanguage
} from "@codemirror/language"
import { styleTags, tags } from "@lezer/highlight"
import { parser as baseParser } from "./parser.js"

export { parser, ravenLanguage, raven }

const parser = baseParser.configure({
  props: [
    styleTags({
      "SyntaxHead!": tags.keyword,
      "AttributeName!": tags.attributeName,
      "FieldName!": tags.propertyName,
      Identifier: tags.variableName,
      Number: tags.number,
      "String TemplateString": tags.string,
      LineComment: tags.lineComment,
      "Operator PrefixOperator HeadOperator Splat": tags.operator,
      At: tags.meta,
      "OpenParen CallOpenParen CloseParen OpenBracket IndexOpenBracket CloseBracket LBrace RBrace": tags.bracket,
      "FieldDot Comma": tags.punctuation
    }),
    indentNodeProp.add({
      Block: delimitedIndent({ closing: "RBrace" }),
      "Group Call": delimitedIndent({ closing: "CloseParen" }),
      "List Index": delimitedIndent({ closing: "CloseBracket" })
    }),
    foldNodeProp.add({
      "Block Group List Call Index": foldInside
    })
  ]
})

const ravenLanguage = LRLanguage.define({
  name: "raven",
  parser,
  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "[", "{", "\"", "`"] },
    wordChars: "!?"
  }
})

function raven(): LanguageSupport {
  return new LanguageSupport(ravenLanguage)
}
