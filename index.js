'use strict';
var loaderUtils = require('loader-utils');
var stylus = require('stylus');
var path = require('path');
var whenNodefn = require('when/node/function');

var CachedPathEvaluator = require('./lib/evaluator');
var ImportCache = require('./lib/import-cache');
var resolver = require('./lib/resolver');

function needsArray(value) {
  return Array.isArray(value) ? value : [value];
}

module.exports = function(source) {
  var self = this;
  if (this.cacheable) {
    this.cacheable();
  }
  var done = this.async();
  var options = loaderUtils.parseQuery(this.query);
  options.dest = options.dest || '';
  options.filename = options.filename || this.resourcePath;
  options.Evaluator = CachedPathEvaluator;

  // Attach `importCache` to `options` so that the `Evaluator` can access it.
  var importCache = options.importCache = new ImportCache(this);

  var configKey = options.config || 'stylus';
  var stylusOptions = this.options[configKey] || {};

  // Handle `use` ahead of time for Stylus, otherwise it will try to call
  // each plugin on every render attempt.
  var use = needsArray(options.use || stylusOptions.use || []);

  options.use = [];
  options.import = options.import || stylusOptions.import || [];
  options.include = options.include || stylusOptions.include || [];
  options.set = options.set || stylusOptions.set || {};
  options.define = options.define || stylusOptions.define || {};

  if (options.sourceMap != null) {
    options.sourcemap = options.sourceMap;
    delete options.sourceMap;
  } else if (this.sourceMap) {
    options.sourcemap = { comment: false };
  }

  var styl = stylus(source, options);
  var paths = [path.dirname(options.filename)];

  if (options.paths && !Array.isArray(options.paths)) {
    paths = paths.concat(options.paths);
    options.paths = [options.paths];
  }

  needsArray(use).forEach(function(plugin) {
    if (typeof plugin === 'function') {
      styl.use(plugin);
    } else {
      throw new Error('Plugin should be a function');
    }
  });

  Object.keys(options).forEach(function(key) {
    var value = options[key];
    if (key === 'set') {
      for (var name in value) {
        styl.set(name, value[name]);
      }
    } else if (key === 'define') {
      for (var defineName in value) {
        styl.define(defineName, value[defineName]);
      }
    } else if (key === 'include') {
      needsArray(value).forEach(function(includePath) {
        styl.include(includePath);
      });
    } else if (key === 'import') {
      needsArray(value).forEach(function(file) {
        styl.import(file);
      });
    } else {
      styl.set(key, value);

      if (key === 'resolve url' && value) {
        styl.define('url', resolver());
      }
    }
  });

  // `styl.render`, promisified.
  var renderStylus = whenNodefn.lift(styl.render).bind(styl);

  function tryRender() {
    return renderStylus().then(function(css) {
      return {
        css: css,
        sourcemap: styl.sourcemap
      };
    }).catch(importCache.createUnresolvedImportHandler(tryRender));
  }

  tryRender().then(function(result) {
    // Tell `webpack` about all the dependencies found during render.
    importCache.getDependencies().forEach(function(file) {
      self.addDependency(file);
    });
    done(null, result.css, result.sourcemap);
  }).catch(done);
};
