'use strict';

var assert = require('assert');
var TokenStream = require('token-stream');
var error = require('pug-error');
var inlineTags = require('./lib/inline-tags');

module.exports = parse;
module.exports.Parser = Parser;
function parse(tokens, options) {
  var parser = new Parser(tokens, options);
  var ast = parser.parse();
  return JSON.parse(JSON.stringify(ast));
};

/**
 * Initialize `Parser` with the given input `str` and `filename`.
 *
 * @param {String} str
 * @param {String} filename
 * @param {Object} options
 * @api public
 */

function Parser(tokens, options) {
  options = options || {};
  if (!Array.isArray(tokens)) {
    throw new Error('Expected tokens to be an Array but got "' + (typeof tokens) + '"');
  }
  if (typeof options !== 'object') {
    throw new Error('Expected "options" to be an object but got "' + (typeof options) + '"');
  }
  this.tokens = new TokenStream(tokens);
  this.filename = options.filename;
  this.src = options.src;
  this.inMixin = 0;
  this.plugins = options.plugins || [];
};

/**
 * Parser prototype.
 */

Parser.prototype = {

  /**
   * Save original constructor
   */

  constructor: Parser,

  error: function (code, message, token) {
    var err = error(code, message, {
      line: token.loc.start.line,
      column: token.loc.start.column,
      filename: token.loc.filename,
      src: this.src
    });
    throw err;
  },

  /**
   * Return the next token object.
   *
   * @return {Object}
   * @api private
   */

  advance: function(){
    return this.tokens.advance();
  },

  /**
   * Single token lookahead.
   *
   * @return {Object}
   * @api private
   */

  peek: function() {
    return this.tokens.peek();
  },

  /**
   * `n` token lookahead.
   *
   * @param {Number} n
   * @return {Object}
   * @api private
   */

  lookahead: function(n){
    return this.tokens.lookahead(n);
  },
  
  /**
   * Add multiple children to a node's array. This joins each child's loc to the parent's and pushes it to the child array.
   * @param {Object} parent - a valid node
   * @param {Object|Object[]} child - a valid node or array of nodes
   * @param {Object[]} [child_array] - array to push or concat the child value to
   * @returns {Object}
   * @api private
   */
  addChildren: function(parent, children, child_array){
    if(!children) return;
    
    for(var i = 0; i < children.length; i++){
      this.addChild(parent, children[i], child_array);
    }
    
    return children;
  },
  
  /**
   * This joins the child's loc to the parent's and returns the child.
   * @param {Object} parent - a valid node
   * @param {Object|Object[]} child - a valid node or array of nodes
   * @returns {Object}
   * @api private
   */
  addChild: function(parent, child, child_array){
    parent.loc = this.addChildLocs(parent.loc, child.loc);
    if(child_array) child_array.push(child);
    return child;
  },
  
  
  /**
   * Add child loc to parent. Expand to the furthest extents. Assumes loc start is always equal to or before end.
   * @param {Object} parent 
   * @param {Object} child 
   * @returns {Object}
   * @api private
   */
  
  addChildLocs: function(parent, child){
    // both can be undefined
    if(!parent && !child) return;
    
    // one may be undefined
    if(!parent) parent = child;
    else if(!child) child = parent;
    
    if(parent.filename !== child.filename) throw new Error('Cannot join loc values from two different source files.');
    
    var r = {
      start: { line: parent.start.line, column: parent.start.column },
      end: { line: child.end.line, column: child.end.column },
      filename: parent.filename
    };
    
    if(parent === child) return r;
    
    if(parent.start.line > child.start.line || (parent.start.line === child.start.line && parent.start.column > child.start.column)){
      r.start.line = child.start.line;
      r.start.column = child.start.column;
    }
    
    if(parent.end.line > child.end.line || (parent.end.line === child.end.line && parent.end.column > child.end.column)){
      r.end.line = parent.end.line;
      r.end.column = parent.end.column;
    }
    
    return r;
  },
  
  emptyLoc: function(tok, loc){
    if(tok.loc){
      return;
    }
    
    tok.loc = {
      start: { line:loc.end.line, column:loc.end.column },
      end: { line:loc.end.line, column:loc.end.column },
      filename: loc.filename
    };
    
    return tok;
  },

  /**
   * Parse input returning a string of js for evaluation.
   *
   * @return {String}
   * @api public
   */

  parse: function(){
    var block = this.emptyBlock();

    while ('eos' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        this.addChildren(block, this.parseTextHtml(), block.nodes);
      } else {
        this.addChild(block, this.parseExpr(), block.nodes);
      }
    }
    
    if(!block.loc){
      block.loc = { start:{ line:1, column:1 }, filename:'', end:{ line:1, column:1 } };
    }

    return block;
  },

  /**
   * Expect the given type, or throw an exception.
   *
   * @param {String} type
   * @api private
   */

  expect: function(type){
    if (this.peek().type === type) {
      return this.advance();
    } else {
      this.error('INVALID_TOKEN', 'expected "' + type + '", but got "' + this.peek().type + '"', this.peek());
    }
  },

  /**
   * Accept the given `type`.
   *
   * @param {String} type
   * @api private
   */

  accept: function(type){
    if (this.peek().type === type) {
      return this.advance();
    }
  },

  initBlock: function(nodes) {
    /* istanbul ignore if */
    if (!Array.isArray(nodes)) throw new Error('`nodes` is not an array');
    var tok = {
      type: 'Block',
      nodes: nodes
    };
    
    for(var i = 0; i < nodes.length; i++){
      tok.loc = this.addChildLocs(tok.loc, nodes[i].loc);
    }
    
    return tok;
  },

  emptyBlock: function() {
    return this.initBlock([]);
  },

  runPlugin: function(context, tok) {
    var rest = [this];
    for (var i = 2; i < arguments.length; i++) {
      rest.push(arguments[i]);
    }
    var pluginContext;
    for (var i = 0; i < this.plugins.length; i++) {
      var plugin = this.plugins[i];
      if (plugin[context] && plugin[context][tok.type]) {
        if (pluginContext) throw new Error('Multiple plugin handlers found for context ' + JSON.stringify(context) + ', token type ' + JSON.stringify(tok.type));
        pluginContext = plugin[context];
      }
    }
    if (pluginContext) return pluginContext[tok.type].apply(pluginContext, rest);
  },

  /**
   *   tag
   * | doctype
   * | mixin
   * | include
   * | filter
   * | comment
   * | text
   * | text-html
   * | dot
   * | each
   * | code
   * | yield
   * | id
   * | class
   * | interpolation
   */

  parseExpr: function(){
    switch (this.peek().type) {
      case 'tag':
        return this.parseTag();
      case 'mixin':
        return this.parseMixin();
      case 'block':
        return this.parseBlock();
      case 'mixin-block':
        return this.parseMixinBlock();
      case 'case':
        return this.parseCase();
      case 'extends':
        return this.parseExtends();
      case 'include':
        return this.parseInclude();
      case 'doctype':
        return this.parseDoctype();
      case 'filter':
        return this.parseFilter();
      case 'comment':
        return this.parseComment();
      case 'text':
      case 'interpolated-code':
      case 'start-pug-interpolation':
        return this.parseText({block: true});
      case 'text-html':
        return this.initBlock(this.parseTextHtml());
      case 'dot':
        return this.parseDot();
      case 'each':
        return this.parseEach();
      case 'code':
        return this.parseCode();
      case 'blockcode':
        return this.parseBlockCode();
      case 'if':
        return this.parseConditional();
      case 'while':
        return this.parseWhile();
      case 'call':
        return this.parseCall();
      case 'interpolation':
        return this.parseInterpolation();
      case 'yield':
        return this.parseYield();
      case 'id':
      case 'class':
        this.tokens.defer({
          type: 'tag',
          val: 'div',
          loc: this.peek().loc
        });
        return this.parseExpr();
      default:
        var pluginResult = this.runPlugin('expressionTokens', this.peek());
        if (pluginResult) return pluginResult;
        this.error('INVALID_TOKEN', 'unexpected token "' + this.peek().type + '"', this.peek());
    }
  },

  parseDot: function() {
    this.advance();
    return this.parseTextBlock();
  },

  /**
   * Text
   */

  parseText: function(options){
    var tags = [];
    var loc = this.peek().loc;
    var nextTok = this.peek();
    loop:
      while (true) {
        switch (nextTok.type) {
          case 'text':
            var tok = this.advance();
            tags.push({
              type: 'Text',
              val: tok.val,
              loc: tok.loc
            });
            break;
          case 'interpolated-code':
            var tok = this.advance();
            tags.push({
              type: 'Code',
              val: tok.val,
              buffer: tok.buffer,
              mustEscape: tok.mustEscape !== false,
              isInline: true,
              loc: tok.loc
            });
            break;
          case 'newline':
            if (!options || !options.block) break loop;
            var tok = this.advance();
            if (this.peek().type === 'text') {
              tags.push({
                type: 'Text',
                val: '\n',
                loc: tok.loc
              });
            }
            break;
          case 'start-pug-interpolation':
            this.advance();
            tags.push(this.parseExpr());
            this.expect('end-pug-interpolation');
            break;
          default:
            var pluginResult = this.runPlugin('textTokens', nextTok, tags);
            if (pluginResult) break;
            break loop;
        }
        nextTok = this.peek();
      }
    if (tags.length === 1) return tags[0];
    else return this.initBlock(tags);
  },

  parseTextHtml: function () {
    var nodes = [];
    var currentNode = null;
loop:
    while (true) {
      switch (this.peek().type) {
        case 'text-html':
          var text = this.advance();
          if (!currentNode) {
            currentNode = {
              type: 'Text',
              val: text.val,
              loc: text.loc,
              isHtml: true
            };
            nodes.push(currentNode);
          } else {
            currentNode.val += '\n' + text.val;
          }
          break;
        case 'indent':
          var block = this.block();
          block.nodes.forEach(function (node) {
            if (node.isHtml) {
              if (!currentNode) {
                currentNode = node;
                nodes.push(currentNode);
              } else {
                currentNode.val += '\n' + node.val;
              }
            } else {
              currentNode = null;
              nodes.push(node);
            }
          });
          break;
        case 'code':
          currentNode = null;
          nodes.push(this.parseCode(true));
          break;
        case 'newline':
          this.advance();
          break;
        default:
          break loop;
      }
    }
    return nodes;
  },

  /**
   *   ':' expr
   * | block
   */

  parseBlockExpansion: function(){
    var tok = this.accept(':');
    if (tok) {
      return this.initBlock([this.parseExpr()]);
    } else {
      return this.block();
    }
  },

  /**
   * case
   */

  parseCase: function(){
    var tok = this.expect('case');
    var node = {type: 'Case', expr: tok.val, loc: tok.loc};

    var block = this.emptyBlock();
    this.expect('indent');
    while ('outdent' != this.peek().type) {
      switch (this.peek().type) {
        case 'comment':
        case 'newline':
          this.advance();
          break;
        case 'when':
          this.addChild(block, this.parseWhen(), block.nodes);
          break;
        case 'default':
          this.addChild(block, this.parseDefault(), block.nodes);
          break;
        default:
          var pluginResult = this.runPlugin('caseTokens', this.peek(), block);
          if (pluginResult) break;
          this.error('INVALID_TOKEN', 'Unexpected token "' + this.peek().type
                          + '", expected "when", "default" or "newline"', this.peek());
      }
    }
    this.expect('outdent');
    
    if(!block.loc){
      node.block = this.emptyLoc(block, tok.loc);
    } else {
      node.block = this.addChild(node, block);
    }


    return node;
  },

  /**
   * when
   */

  parseWhen: function(){
    var tok = this.expect('when');
    var node;
    if (this.peek().type !== 'newline') {
      node = {
        type: 'When',
        expr: tok.val,
        debug: false,
        loc: tok.loc
      };
      node.block = this.addChild(node, this.parseBlockExpansion());
      return node;
    } else {
      return {
        type: 'When',
        expr: tok.val,
        debug: false,
        loc: tok.loc
      };
    }
  },

  /**
   * default
   */

  parseDefault: function(){
    var tok = this.expect('default');
    var node = {
      type: 'When',
      expr: 'default',
      debug: false,
      loc: tok.loc
    };
    node.block = this.addChild(node, this.parseBlockExpansion());
    return node;
  },

  /**
   * code
   */

  parseCode: function(noBlock){
    var tok = this.expect('code');
    assert(typeof tok.mustEscape === 'boolean', 'Please update to the newest version of pug-lexer.');
    var node = {
      type: 'Code',
      val: tok.val,
      buffer: tok.buffer,
      mustEscape: tok.mustEscape !== false,
      isInline: !!noBlock,
      loc: tok.loc
    };
    // todo: why is this here?  It seems like a hacky workaround
    if (node.val.match(/^ *else/)) node.debug = false;

    if (noBlock) return node;

    var block;

    // handle block
    block = 'indent' == this.peek().type;
    if (block) {
      if (tok.buffer) {
        this.error('BLOCK_IN_BUFFERED_CODE', 'Buffered code cannot have a block attached to it', this.peek());
      }
      node.block = this.addChild(node, this.block());
    }

    return node;
  },
  
  parseConditional: function(){
    var tok = this.expect('if');
    var node = {
      type: 'Conditional',
      test: tok.val,
      alternate: null,
      loc: tok.loc
    };

    // handle block
    if ('indent' == this.peek().type) {
      node.consequent = this.addChild(node, this.block());
    } else {
      node.consequent = this.emptyLoc(this.emptyBlock(), node.loc);
    }
    
    var alt = this.parseConditionalElse(node);
    
    if(alt){
      node.alternate = this.addChild(node, alt);
    }

    return node;
  },
  
  parseConditionalElse: function(parent){
    while(this.peek().type === 'newline') {
      this.expect('newline');
    }
    
    if (this.peek().type === 'else-if') {
      var tok = this.expect('else-if');
      
      var node = {
        type: 'Conditional',
        test: tok.val,
        alternate: null,
        loc: tok.loc
      };
      
      
      if ('indent' == this.peek().type) {
        node.consequent = this.addChild(node, this.block());
      } else {
        node.consequent = this.emptyLoc(this.emptyBlock(), tok.loc);
      }
      
      var alt = this.parseConditionalElse(node);
      
      if(alt){
        node.alternate = this.addChild(node, alt);
      }
      
      return node;
    }
    
    if (this.peek().type === 'else') {
      parent.loc = this.addChildLocs(parent.loc, this.expect('else').loc);
      
      if (this.peek().type === 'indent') {
        return this.block();
      }
    }
  },
  
  parseWhile: function(){
    var tok = this.expect('while');
    var node = {
      type: 'While',
      test: tok.val,
      loc: tok.loc
    };

    // handle block
    if ('indent' == this.peek().type) {
      node.block = this.block();
    } else {
      node.block = this.emptyBlock();
    }

    return node;
  },

  /**
   * block code
   */

  parseBlockCode: function(){
    var loc = this.expect('blockcode').loc;
    var body = this.peek();
    var text = '';
    if (body.type === 'start-pipeless-text') {
      this.advance();
      while (this.peek().type !== 'end-pipeless-text') {
        var tok = this.advance();
        switch (tok.type) {
          case 'text':
            text += tok.val;
            loc = this.addChildLocs(loc, tok.loc);
            break;
          case 'newline':
            text += '\n';
            loc = this.addChildLocs(loc, tok.loc);
            break;
          default:
            var pluginResult = this.runPlugin('blockCodeTokens', tok, tok);
            if (pluginResult) {
              text += pluginResult;
              break;
            }
            this.error('INVALID_TOKEN', 'Unexpected token type: ' + tok.type, tok);
        }
      }
      this.advance();
    }
    return {
      type: 'Code',
      val: text,
      buffer: false,
      mustEscape: false,
      isInline: false,
      loc: loc
    };
  },
  /**
   * comment
   */

  parseComment: function(){
    var tok = this.expect('comment');
    var block;
    if (block = this.parseTextBlock()) {
      return {
        type: 'BlockComment',
        val: tok.val,
        block: block,
        buffer: tok.buffer,
        loc: this.addChildLocs(tok.loc, block.loc)
      };
    } else {
      return {
        type: 'Comment',
        val: tok.val,
        buffer: tok.buffer,
        loc: tok.loc
      };
    }
  },

  /**
   * doctype
   */

  parseDoctype: function(){
    var tok = this.expect('doctype');
    return {
      type: 'Doctype',
      val: tok.val,
      loc: tok.loc
    };
  },

  parseIncludeFilter: function() {
    var tok = this.expect('filter');
    var attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs(tok);
    }

    return {
      type: 'IncludeFilter',
      name: tok.val,
      attrs: attrs,
      loc: tok.loc
    };
  },

  /**
   * filter attrs? text-block
   */

  parseFilter: function(){
    var tok = this.expect('filter');
    var block, attrs = [];

    if (this.peek().type === 'start-attributes') {
      attrs = this.attrs(tok);
    }

    if (this.peek().type === 'text') {
      var textToken = this.advance();
      block = this.initBlock([
        {
          type: 'Text',
          val: textToken.val,
          loc: textToken.loc
        }
      ]);
    } else if (this.peek().type === 'filter') {
      block = this.initBlock([this.parseFilter()]);
    } else {
      block = this.parseTextBlock() || this.emptyBlock();
    }

    return {
      type: 'Filter',
      name: tok.val,
      block: block,
      attrs: attrs,
      loc: tok.loc
    };
  },

  /**
   * each block
   */

  parseEach: function(){
    var tok = this.expect('each');
    var node = {
      type: 'Each',
      obj: tok.code,
      val: tok.val,
      key: tok.key,
      loc: tok.loc
    };
    node.block = this.addChild(node, this.block());
    if (this.peek().type == 'else') {
      this.advance();
      node.alternate = this.addChild(node, this.block());
    }
    return node;
  },

  /**
   * 'extends' name
   */

  parseExtends: function(){
    var tok = this.expect('extends');
    var path = this.expect('path');
    return {
      type: 'Extends',
      file: {
        type: 'FileReference',
        path: path.val.trim(),
        loc: path.loc
      },
      loc: this.addChildLocs(tok.loc, path.loc)
    };
  },

  /**
   * 'block' name block
   */

  parseBlock: function(){
    var tok = this.expect('block');

    var node = 'indent' == this.peek().type ? this.block() : this.emptyBlock();
    node.type = 'NamedBlock';
    node.name = tok.val.trim();
    node.mode = tok.mode;
    node.loc = this.addChildLocs(node.loc, tok.loc);

    return node;
  },

  parseMixinBlock: function () {
    var tok = this.expect('mixin-block');
    if (!this.inMixin) {
      this.error('BLOCK_OUTISDE_MIXIN', 'Anonymous blocks are not allowed unless they are part of a mixin.', tok);
    }
    return {type: 'MixinBlock', loc: tok.loc};
  },

  parseYield: function() {
    var tok = this.expect('yield');
    return {type: 'YieldBlock', loc: tok.loc};
  },

  /**
   * include block?
   */

  parseInclude: function(){
    var tok = this.expect('include');
    var node = {
      type: 'Include',
      file: {
        type: 'FileReference',
        loc: tok.loc
      },
      loc: tok.loc
    };
    
    var filters = [];
    while (this.peek().type === 'filter') {
      filters.push(this.parseIncludeFilter());
    }
    var path = this.expect('path');

    node.file.path = path.val.trim();

    if ((/\.jade$/.test(node.file.path) || /\.pug$/.test(node.file.path)) && !filters.length) {
      node.block = 'indent' == this.peek().type ? this.block() : this.emptyBlock();
      if (/\.jade$/.test(node.file.path)) {
        console.warn(
          this.filename + ', line ' + tok.line +
          ':\nThe .jade extension is deprecated, use .pug for "' + node.file.path +'".'
        );
      }
    } else {
      node.type = 'RawInclude';
      node.filters = filters;
      if (this.peek().type === 'indent') {
        this.error('RAW_INCLUDE_BLOCK', 'Raw inclusion cannot contain a block', this.peek());
      }
    }
    return node;
  },

  /**
   * call ident block
   */

  parseCall: function(){
    var tok = this.expect('call');
    var name = tok.val;
    var args = tok.args;
    var mixin = {
      type: 'Mixin',
      name: name,
      args: args,
      block: this.emptyBlock(),
      call: true,
      attrs: [],
      attributeBlocks: [],
      loc: tok.loc
    };

    this.tag(mixin);
    if (mixin.code) {
      mixin.block.nodes.push(mixin.code);
      delete mixin.code;
    }
    if (mixin.block.nodes.length === 0) mixin.block = null;
    return mixin;
  },

  /**
   * mixin block
   */

  parseMixin: function(){
    var tok = this.expect('mixin');
    var name = tok.val;
    var args = tok.args;

    if ('indent' == this.peek().type) {
      this.inMixin++;
      var mixin = {
        type: 'Mixin',
        name: name,
        args: args,
        block: this.block(),
        call: false,
        loc: tok.loc
      };
      this.inMixin--;
      return mixin;
    } else {
      this.error('MIXIN_WITHOUT_BODY', 'Mixin ' + name + ' declared without body', tok);
    }
  },

  /**
   * indent (text | newline)* outdent
   */

  parseTextBlock: function(){
    var tok = this.accept('start-pipeless-text');
    if (!tok) return;
    var block = this.emptyBlock();
    while (this.peek().type !== 'end-pipeless-text') {
      var tok = this.advance();
      switch (tok.type) {
        case 'text':
          this.addChild(block, {type: 'Text', val: tok.val, loc: tok.loc}, block.nodes);
          break;
        case 'newline':
          this.addChild(block, {type: 'Text', val: '\n', loc: tok.loc}, block.nodes);
          break;
        case 'start-pug-interpolation':
          this.addChild(block, this.parseExpr(), block.nodes);
          this.expect('end-pug-interpolation');
          break;
        case 'interpolated-code':
          this.addChild(block, {
            type: 'Code',
            val: tok.val,
            buffer: tok.buffer,
            mustEscape: tok.mustEscape !== false,
            isInline: true,
            loc: tok.loc
          }, block.nodes);
          break;
        default:
          var pluginResult = this.runPlugin('textBlockTokens', tok, block, tok);
          if (pluginResult) break;
          this.error('INVALID_TOKEN', 'Unexpected token type: ' + tok.type, tok);
      }
    }
    this.advance();
    return block;
  },

  /**
   * indent expr* outdent
   */

  block: function(){
    var tok = this.expect('indent');
    var block = this.emptyBlock();
    while ('outdent' != this.peek().type) {
      if ('newline' == this.peek().type) {
        this.advance();
      } else if ('text-html' == this.peek().type) {
        this.addChildren(block, this.parseTextHtml(), block.nodes);
      } else {
        this.addChild(block, this.parseExpr(), block.nodes);
      }
    }
    this.expect('outdent');
    return block;
  },

  /**
   * interpolation (attrs | class | id)* (text | code | ':')? newline* block?
   */

  parseInterpolation: function(){
    var tok = this.advance();
    var tag = {
      type: 'InterpolatedTag',
      expr: tok.val,
      selfClosing: false,
      block: this.emptyBlock(),
      attrs: [],
      attributeBlocks: [],
      isInline: false,
      loc: tok.loc
    };

    return this.tag(tag, {selfClosingAllowed: true});
  },

  /**
   * tag (attrs | class | id)* (text | code | ':')? newline* block?
   */

  parseTag: function(){
    var tok = this.advance();
    var tag = {
      type: 'Tag',
      name: tok.val,
      selfClosing: false,
      block: this.emptyBlock(),
      attrs: [],
      attributeBlocks: [],
      isInline: inlineTags.indexOf(tok.val) !== -1,
      loc: tok.loc
    };

    return this.tag(tag, {selfClosingAllowed: true});
  },

  /**
   * Parse tag.
   */

  tag: function(tag, options) {
    var seenAttrs = false;
    var attributeNames = [];
    var selfClosingAllowed = options && options.selfClosingAllowed;
    // (attrs | class | id)*
    out:
      while (true) {
        switch (this.peek().type) {
          case 'id':
          case 'class':
            var tok = this.advance();
            if (tok.type === 'id') {
              if (attributeNames.indexOf('id') !== -1) {
                this.error('DUPLICATE_ID', 'Duplicate attribute "id" is not allowed.', tok);
              }
              attributeNames.push('id');
            }
            this.addChild(tag, {
              name: tok.type,
              val: "'" + tok.val + "'",
              mustEscape: false,
              loc: tok.loc
            }, tag.attrs);
            continue;
          case 'start-attributes':
            if (seenAttrs) {
              console.warn(this.filename + ', line ' + this.peek().line + ':\nYou should not have pug tags with multiple attributes.');
            }
            seenAttrs = true;
            this.addChildren(tag, this.attrs(tag, attributeNames), tag.attrs);
            continue;
          case '&attributes':
            var tok = this.advance();
            tag.loc = this.addChildLocs(tag.loc, tok.loc);
            tag.attributeBlocks.push(tok.val);
            break;
          default:
            var pluginResult = this.runPlugin('tagAttributeTokens', this.peek(), tag, attributeNames);
            if (pluginResult) break;
            break out;
        }
      }

    // check immediate '.'
    if ('dot' == this.peek().type) {
      tag.textOnly = true;
      this.advance();
    }

    // (text | code | ':')?
    switch (this.peek().type) {
      case 'text':
      case 'interpolated-code':
        var text = this.parseText();
        if (text.type === 'Block') {
          this.addChildren(tag.block, text.nodes, tag.block.nodes);
        } else {
          this.addChild(tag.block, text, tag.block.nodes);
        }
        break;
      case 'code':
        this.addChild(tag.block, this.parseCode(true), tag.block.nodes);
        break;
      case ':':
        this.advance();
        tag.block = this.addChild(tag, this.initBlock([this.parseExpr()]));
        break;
      case 'newline':
      case 'indent':
      case 'outdent':
      case 'eos':
      case 'start-pipeless-text':
      case 'end-pug-interpolation':
        break;
      case 'slash':
        if (selfClosingAllowed) {
          this.addChildLocs(tag.loc, this.advance().loc);
          tag.selfClosing = true;
          break;
        }
      default:
        var pluginResult = this.runPlugin('tagTokens', this.peek(), tag, options);
        if (pluginResult) break;
        this.error('INVALID_TOKEN', 'Unexpected token `' + this.peek().type + '` expected `text`, `interpolated-code`, `code`, `:`' + (selfClosingAllowed ? ', `slash`' : '') + ', `newline` or `eos`', this.peek())
    }

    // newline*
    while ('newline' == this.peek().type) this.advance();

    // block?
    if (tag.textOnly) {
      tag.block = this.parseTextBlock() || this.emptyBlock();
    } else if ('indent' == this.peek().type) {
      this.addChildren(tag.block, this.block().nodes, tag.block.nodes);
    }
    
    if(!tag.block.loc){
      this.emptyLoc(tag.block, tag.loc);
    }
    
    tag.loc = this.addChildLocs(tag.loc, tag.block.loc);

    return tag;
  },

  attrs: function(parent, attributeNames) {
    this.expect('start-attributes');

    var attrs = [];
    var tok = this.advance();
    while (tok.type === 'attribute') {
      if (tok.name !== 'class' && attributeNames) {
        if (attributeNames.indexOf(tok.name) !== -1) {
          this.error('DUPLICATE_ATTRIBUTE', 'Duplicate attribute "' + tok.name + '" is not allowed.', tok);
        }
        attributeNames.push(tok.name);
      }
      attrs.push({
        name: tok.name,
        val: tok.val,
        mustEscape: tok.mustEscape !== false,
        loc: tok.loc
      });
      tok = this.advance();
    }
    this.tokens.defer(tok);
    this.expect('end-attributes');
    parent.loc = this.addChildLocs(parent.loc, tok.loc);
    return attrs;
  }
};
