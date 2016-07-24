'use strict';
var fs = require('fs');
var dirname = require('path').dirname;
var whenNodefn = require('when/node/function');
var Parser = require('stylus/lib/parser');
var Visitor = require('stylus/lib/visitor');
var nodes = require('stylus/lib/nodes');

// ImportVisitor is a simple stylus ast visitor that navigates the graph
// building a list of imports in it.
function ImportVisitor(root) {
  Visitor.call(this, root);
  this.importedPaths = [];
}

ImportVisitor.prototype = Object.create(Visitor.prototype);
ImportVisitor.prototype.constructor = ImportVisitor;

ImportVisitor.prototype.visitImport = function(node) {
  // Only find static imports, not dynamic expressions.
  if (node.path.nodes.length === 1 && node.path.first.constructor.name === 'String') {
    var name = node.path.first.val;
    this.importedPaths.push(name);
  }
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

ImportVisitor.prototype.visitBlock = ImportVisitor.prototype.visitRoot;

// Return a Promise resolving to a list of paths that given file imports.
function visitImports(filename, knownSource, sourceCache) {
  // If we already have the source, don't bother reading the file.
  var promise = knownSource == null ?
    whenNodefn.call(fs.readFile, filename, 'utf8') :
    Promise.resolve(knownSource);

  return promise.then(function(source) {
    // If `source` is in `sourceCache`, don't bother parsing and visiting the
    // AST - we already know what strings are imported. However, they might
    // have been imported from a file with in a different location, meaningful
    // `context` will be different - so just get the import strings and then
    // return them with this file's `context` at the end.
    var importedPaths = sourceCache[source];
    if (!importedPaths) {
      var _filename = nodes.filename;
      nodes.filename = filename;
      // Current idea here is to silence errors and let them rise in stylus's
      // renderer which has more handling so that the error message is more
      // meaningful and easy to understand.
      var parser = new Parser(source, { cache: false });

      try {
        var ast = parser.parse();
      } catch (e) {
        return [];
      } finally {
        nodes.filename = _filename;
      }

      var importVisitor = new ImportVisitor(ast);
      importVisitor.visit(ast);
      importedPaths = importVisitor.importedPaths;
      sourceCache[source] = importedPaths;
    }

    var context = dirname(filename);
    return importedPaths.map(function(name) {
      return [context, name];
    });
  });
}

module.exports = visitImports;
