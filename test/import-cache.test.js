var should = require("should");
var ImportCache = require("../lib/import-cache");

describe("ImportCache", function() {
  it("should be able to cache imports", function() {
    var importCache = new ImportCache({ resolve: function() {} }, {});
    should.not.exist(importCache.lookupImport("x", "y"));
    importCache.cacheImport("x", "y", "foo");
    importCache.lookupImport("x", "y").should.eql("foo");
    should.not.exist(importCache.lookupImport("x", "z"));
    importCache.cacheImport("x", "z", "bar");
    importCache.lookupImport("x", "y").should.eql("foo");
    importCache.lookupImport("x", "z").should.eql("bar");
  });

  it("should resolve stylus imports", function() {
    function resolve(context, request, callback) {
      if (context === "x" && request === "y.styl") {
        callback(null, "foo");
      } else if (context === "x" && request === "z/index.styl") {
        callback(null, "bar");
      } else {
        callback(new Error("could not resolve"));
      }
    }
    var importCache = new ImportCache({ resolve: resolve }, {});
    return Promise.all([
      importCache.resolveStylusImport("a", "b").should.be.rejected(),
      importCache.resolveStylusImport("x", "y").should.be.fulfilledWith("foo"),
      importCache.resolveStylusImport("x", "z").should.be.fulfilledWith("bar")
    ]);
  });
});
