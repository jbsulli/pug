"use strict";

const PugError = require("pug-error");

// blank,eos,endInterpolation,yield,doctype,interpolation,case,when,default,extends,append,prepend,block,mixinBlock,include,mixin,call,conditional,each,while,tag,filter,blockCode,code,id,dot,className,attrs,attributesBlock,indent,text,textHtml,comment,slash,colon,fail
const STATES = [
  "blank,eos,doctype,case,when,default,tag,fail".split(","),
]

const STATE_FINISHED = -1;
const STATE_DEFAULT = 0;
const STATE_TAG = 1;
const STATE_INTERPOLATION = 2;

// errors
const NO_END_BRACKET = 0;
const INVALID_INDENTATION = 1;
const INCONSISTENT_INDENTATION = 2;
const UNEXPECTED_TEXT = 3;

// TODO: language file
const ERROR_MESSAGES = [
  "The end input reached with no closing bracket",
  "Invalid indentation, you can use tabs or spaces but not both",
  "Inconsistent indentation",
  "Unexpected text"
];

const REGEX = {
  blank: /^[ \t]*\n/,
  doctype: /^doctype *(.*) *$/,
  indentChar: /^( |\t)/,
  tag: /^(\w(?:[-:\w]*\w)?)/
};

module.exports = (str, options) => {
  return (new Lexer(str, options)).getTokens();
};

class Lexer {
  constructor(str, options) {
    options = options || {};
    if (typeof str !== "string") {
      throw new Error(`Expected source code to be a string but got "${typeof str}"`);
    }
    if (typeof options !== "object") {
      throw new Error(`Expected "options" to be an object but got "${typeof str}"`);
    }
    
    this.original = str
        .replace(/^\uFEFF/, "")     // remove BOM
        .replace(/\r\n|\r/g, "\n"); // standardize line returns
      
    this.lines = this.original.split("\n");
    this.line = this.lines[0];
        
    this.filename = options.filename;
    this.i = 0;
    this.indent = undefined;
    this.indentStr = undefined;
    this.indents = 0;
    this.lineIndex = options.startingLine || 1;
    this.columnIndex = options.startingColumn || 1;
    this.tokens = [];
    this.state = STATE_DEFAULT;
    this.states = [this.state];
    
    // TODO: plugin support
  }
  
  advance() {
    const tokenizers = STATES[this.state];
    
    return tokenizers.find(tokenizer => this[tokenizer] && this[tokenizer]());
  }
  
  blank() {
    if (this.lines[0].match(REGEX.blank)) {
      return this.incrementLine();
    }
  }
  
  endInterpolation() {
    
  }
  
  eos() {
    if (this.lines.length) return;
    if (this.state === STATE_INTERPOLATION) {
      this.error(NO_END_BRACKET);
    }
    while (this.indents) {
      this.push(this.tok('outdent'));
      this.indents--;
    }
    this.push(this.tok('eos'));
    this.state = STATE_FINISHED;
    return true;
  }
  
  error(code) {
    throw PugError(code, ERROR_MESSAGES[code], { 
      line: this.lineIndex, 
      col: this.columnIndex, 
      filename: this.filename, 
      src: this.original
    });
  }
  
  fail() {
    this.error(UNEXPECTED_TEXT);
  }
  
  getTokens() {
    while (this.advance());
    return this.tokens;
  }
  
  incrementLine(lines) {
    lines = lines || 1;
    this.lines = this.lines.slice(lines);
    this.line = this.lines[0];
    this.lineIndex += lines;
    this.columnIndex = 1;
    
    let len = this.indentStr.length;
    
    if (this.indents && (this.line.length < len || this.line.substr(0, len) !== this.indentStr)) {
      if (this.line.replace(this.indent, "") === "") {
        this.columnIndex = this.line.length;
        this.line = ""; // blank line
      } else {
        this.outdent();
        len = this.indentStr.length;
      }
    }
    
    this.line = this.line.substr(0, len);
    this.columnIndex += len;
    
    return true;
  }
  
  outdent() {
    let indents = 0;
    const len = this.indent.length;
    while (this.line.length > len && this.line.substr(0, len) === this.indent) indents++;
    for (; this.indents > indents; this.indents--) {
      this.push(this.tok("outdent"));
    }
    this.line = this.line.substr(indents * len);
    if (this.line.match(REGEX.indentChar)) {
      this.error(INCONSISTENT_INDENTATION);
    }
    return true;
  }
  
  push(token) {
    this.tokens.push(token);
  }
  
  tag() {
    let match;
    if (match = REGEX.tag.exec(this.line)) {
      return true;
    }
  }
  
  tok(type, addl) {
    const result = {
      type,
      loc: {
        end: { 
          line: this.lineIndex,
          col: this.columnIndex
        },
        filename,
        start: { 
          line: this.lineIndex,
          col: this.columnIndex
        }
      }
    };
    return Object.assign(result, addl);
  }
  
  tokFromRegex(type, regex) {
    const match = regex.exec(this.line);
    if (match) {
      
    }
    const tok = this.tok
  }
}
