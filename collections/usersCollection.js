var userHelper = require("../helpers/userHelper.js");
var isEmpty = require("../helpers/isEmpty.js");

import { extractCallback } from "../helpers/argsParser.mjs";

module.exports = UsersCollection;

function UsersCollection(yf) {
  this.yf = yf;
}

// this doesn't seem super useful...
UsersCollection.prototype.fetch = function() {
  const cb = extractCallback(args);
  var subresources = arguments.length ? arguments[0] : [];

  var url = "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1";

  if (!isEmpty(subresources)) {
    if ("string" === typeof subresources) {
      subresources = [subresources];
    }

    url += ";out=" + subresources.join(",");
  }

  url += "?format=json";

  return this.yf
    .api(this.yf.GET, url)
    .then(data => {
      const user = userHelper.parseCollection(
        data.fantasy_content.users[0].user
      );
      cb(null, user);
      return user;
    })
    .catch(e => {
      cb(e);
      throw e;
    });
};
