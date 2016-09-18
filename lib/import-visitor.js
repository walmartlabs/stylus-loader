'use strict';
var fs = require('fs');
var dirname = require('path').dirname;
var Promise = require('es6-promise').Promise;
var Parser = require('stylus/lib/parser');
var Visitor = require('stylus/lib/visitor');

var debug = require('debug')('stylus-relative-loader:import-visitor');

function evaluateStatic(node, importVariables) {
  var value;
  if (node.constructor.name === 'String') {
    value = node.string;
  } else if (node.constructor.name === 'BinOp' && node.op === '+') {
    var left = evaluateStatic(node.left, importVariables);
    var right = evaluateStatic(node.right, importVariables);
    if (left && !left.isNull && right && !right.isNull) {
      value = left + right;
      debug('evaluateStatic BinOp: %s', value);
    }
  } else if (node.constructor.name === 'Ident') {
    if (importVariables[node.name] != null) {
      value = node.val && !node.val.isNull
        ? node.val
        : importVariables[node.name];
    }
  }
  return value;
}

// ImportVisitor is a simple stylus ast visitor that navigates the graph
// building a list of imports in it.
function ImportVisitor(root, options) {
  Visitor.apply(this, arguments);
  this.importVariables = options.importVariables &&
    options.importVariables.length ? options.importVariables : [{}];
  this.importPaths = {};
}

ImportVisitor.prototype = Object.create(Visitor.prototype);
ImportVisitor.prototype.constructor = ImportVisitor;

ImportVisitor.prototype.visitImport = function(node) {
  var path = node.path.first;
  this.importVariables.forEach(function(importVariables) {
    var string = evaluateStatic(path, importVariables);
    if (string != null) {
      this.importPaths[string] = true;
    }
  }, this);
  return node;
};

ImportVisitor.prototype.visitRoot = function(block) {
  for (var i = 0; i < block.nodes.length; ++i) {
    this.visit(block.nodes[i]);
  }
  return block;
};

ImportVisitor.prototype.visitExpression = function(expr) {
  for (var i = 0; i < expr.nodes.length; ++i) {
    this.visit(expr.nodes[i]);
  }
  return expr;
};

ImportVisitor.prototype.visitCall = function(fn) {
  if (fn.name === 'use' || fn.name === 'json') {
    var path = fn.args.first;
    this.importVariables.forEach(function(importVariables) {
      var string = evaluateStatic(path, importVariables);
      if (string != null) {
        this.importPaths[string] = true;
      }
    }, this);
  }
  return fn;
};

ImportVisitor.prototype.visitSelector = function(sel) {
  for (var i = 0; i < sel.block.nodes.length; i++) {
    this.visit(sel.block.nodes[i]);
  }
  return sel;
};

ImportVisitor.prototype.visitBlock = ImportVisitor.prototype.visitRoot;
ImportVisitor.prototype.visitGroup = ImportVisitor.prototype.visitRoot;

/**
 * We could use the real Stylus parser and visit each node in the AST to find
 * imports. But given that we only need to discover import-like things for
 * performance purposes, and not to render successfully, it's faster just to
 * scan the source string for lines that look like imports. Even if we don't
 * find all imports, or find commented-out imports, it won't affect the final
 * rendered output.
 * @param {String} filename - The filename of the file being processed.
 * @param {String|null} knownSource - The contents of the file, if already
 *                                    known; this was save us from having to
 *                                    read the file.
 * @param {Array} importVariables - An array of Stylus variable values to give
 *                                  variables used in import expressions.
 *                                  Improves performance by allowing more
 *                                  imports to be visited before render time.
 * @returns {Promise} Promise resolving to an array of [context, name] pairs.
 */
function visitImports(filename, knownSource, importVariables) {
  // Promisify here instead of outer scope because in tests, `fs` will be
  // replaced with `empty` module.
  var readFile = function(file, options) {
    return new Promise(function(resolve, reject) {
      fs.readFile(file, options, function(err, data) {
        return err ? reject(err) : resolve(data);
      });
    });
  };
  var promise = knownSource == null ?
    readFile(filename, 'utf8') : Promise.resolve(knownSource);

  return promise.then(function(source) {
    var ast;

    try {
      ast = new Parser(source, { cache: false }).parse();
    } catch (err) {
      debug('Parse error: %s', err);
      return [];
    }

    var importVisitor = new ImportVisitor(ast, {
      importVariables: importVariables
    });
    importVisitor.visit(ast);

    var context = dirname(filename);
    var importPaths = Object.keys(importVisitor.importPaths);

    debug('Found %s import(s) in %s', importPaths.length, filename);

    return importPaths.map(function(name) {
      return [context, name];
    });
  });
}

module.exports = visitImports;
