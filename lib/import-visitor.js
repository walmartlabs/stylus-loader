'use strict';
var fs = require('fs');
var dirname = require('path').dirname;
var Promise = require('bluebird');

// Find lines that look like:
// @require "...";
// @import '...';
// etc.
var regex = /^\s*@(?:import|require) +['"]([^'"$]+)['"]/m;

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
 * @returns {Promise} Promise resolving to an array of [context, name] pairs.
 */
function visitImports(filename, knownSource) {
  // Promisify here instead of outer scope because in tests, `fs` will be
  // replaced with `empty` module.
  var readFile = Promise.promisify(fs.readFile);
  var promise = knownSource == null ?
    readFile(filename, 'utf8') : Promise.resolve(knownSource);

  return promise.then(function(source) {
    var parts = source.split(regex);
    var importedPaths = [];
    for (var i = 1; i < parts.length; i += 2) {
      importedPaths.push(parts[i]);
    }
    var context = dirname(filename);
    return importedPaths.map(function(name) {
      return [context, name];
    });
  });
}

module.exports = visitImports;
