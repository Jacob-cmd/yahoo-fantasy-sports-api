/* global module, require */
import https from "https";
import { stringify } from "querystring";
import crypto from "crypto";
// TODO: we can remove this fairly easily: https://medium.com/@pandeysoni/how-to-create-oauth-1-0a-signature-in-node-js-7d477dead170
// just make sure that each param is fully encoded (ie/ format=json not just the json piece)
import oauthSignature from "oauth-signature";

import {
  Game,
  League,
  Player,
  Roster,
  Team,
  Transaction,
  User,
} from "./resources";

import { Games, Leagues, Players, Teams } from "./collections"; // Transactions, Users } from "./collections";

class YahooFantasy {
  // redirect only needed if you're handling the auth with this lib
  constructor(consumerKey, consumerSecret, tokenCallbackFn, redirectUri) {
    this.CONSUMER_KEY = consumerKey;
    this.CONSUMER_SECRET = consumerSecret;
    this.REDIRECT_URI = redirectUri;
    this.refreshTokenCallback = tokenCallbackFn;

    this.GET = "GET";
    this.POST = "POST";

    this.game = new Game(this);
    this.games = new Games(this);

    this.league = new League(this);
    this.leagues = new Leagues(this);

    this.player = new Player(this);
    this.players = new Players(this);

    this.team = new Team(this);
    this.teams = new Teams(this);

    this.transaction = new Transaction(this);
    // this.transactions = new Transactions(this);

    this.roster = new Roster(this);

    this.user = new User(this);
    // this.users = new Users(); // TODO

    this.yahooUserToken = null;
    this.yahooRefreshToken = null;
  }

  // oauth2 authentication function -- follow redirect to yahoo login
  auth(res) {
    const authData = stringify({
      client_id: this.CONSUMER_KEY,
      redirect_uri: this.REDIRECT_URI,
      response_type: "code",
    });

    const options = {
      hostname: "api.login.yahoo.com",
      port: 443,
      path: `/oauth2/request_auth?${authData}`,
      method: "GET",
    };

    const authRequest = https.request(options, (authResponse) => {
      authResponse.on("data", (d) => {
        process.stdout.write(d);
      });

      authResponse.on("end", () => {
        if (302 === authResponse.statusCode) {
          res.redirect(authResponse.headers.location);
        } else {
          throw new Error("authentication error");
        }
      });
    });

    authRequest.on("error", (e) => {
      throw new Error(e);
    });

    authRequest.end();
  }

  authCallback(req, cb) {
    const tokenData = stringify({
      client_id: this.CONSUMER_KEY,
      client_secret: this.CONSUMER_SECRET,
      redirect_uri: this.REDIRECT_URI,
      code: req.query.code,
      grant_type: "authorization_code",
    });

    const options = {
      hostname: "api.login.yahoo.com",
      port: 443,
      path: `/oauth2/get_token`,
      method: this.POST,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${this.CONSUMER_KEY}:${this.CONSUMER_SECRET}`
        ).toString("base64")}`,
      },
    };

    const tokenRequest = https.request(options, (tokenReponse) => {
      const chunks = [];
      tokenReponse.on("data", (d) => {
        chunks.push(d);
      });

      tokenReponse.on("end", () => {
        const tokenData = JSON.parse(Buffer.concat(chunks));
        this.yahooUserToken = tokenData.access_token;
        this.yahooRefreshToken = tokenData.refresh_token;

        this.refreshTokenCallback(tokenData);

        cb();
      });
    });

    tokenRequest.on("error", (e) => {
      cb(e);
    });

    tokenRequest.write(tokenData);
    tokenRequest.end();
  }

  setUserToken(token) {
    this.yahooUserToken = token;
  }

  setRefreshToken(token) {
    this.yahooRefreshToken = token;
  }

  refreshToken(cb) {
    const refreshData = stringify({
      grant_type: "refresh_token",
      redirect_uri: this.REDIRECT_URI,
      refresh_token: this.yahooRefreshToken,
    });

    const options = {
      hostname: "api.login.yahoo.com",
      port: 443,
      path: "/oauth2/get_token",
      method: this.POST,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${this.CONSUMER_KEY}:${this.CONSUMER_SECRET}`
        ).toString("base64")}`,
      },
    };

    const tokenRequest = https.request(options, (tokenReponse) => {
      const chunks = [];
      tokenReponse.on("data", (d) => {
        chunks.push(d);
      });

      tokenReponse.on("end", () => {
        const tokenData = JSON.parse(Buffer.concat(chunks));

        this.setUserToken(tokenData.access_token);
        this.setRefreshToken(tokenData.refresh_token);
        this.refreshTokenCallback(tokenData);

        cb(null, tokenData);
      });
    });

    tokenRequest.on("error", (e) => {
      cb(e);
    });

    tokenRequest.write(refreshData);
    tokenRequest.end();
  }

  api(...args) {
    const method = args.shift();
    const url = args.shift();
    let postData = false;

    if (args.length && args[0]) {
      postData = args.pop();
    }

    let params = {
      format: "json",
    };

    const headers = {};

    if (!this.yahooUserToken) {
      params = {
        ...params,
        oauth_consumer_key: this.CONSUMER_KEY,
        oauth_signature_method: "HMAC-SHA1",
        oauth_timestamp: Math.floor(Date.now() / 1000),
        oauth_nonce: crypto.randomBytes(12).toString("base64"),
        oauth_version: "1.0",
      };

      const signature = oauthSignature.generate(
        method,
        url,
        params,
        this.CONSUMER_SECRET
      );

      params = {
        ...params,
        oauth_signature: decodeURIComponent(signature),
      };
    } else {
      headers.Authorization = `Bearer ${this.yahooUserToken}`;
    }

    const options = {
      hostname: "fantasysports.yahooapis.com",
      path: `${url.replace(
        "https://fantasysports.yahooapis.com",
        ""
      )}?${stringify(params)}`,
      method: method,
      headers,
    };

    return new Promise((resolve, reject) => {
      https
        .request(options, (resp) => {
          let data = "";

          resp.on("data", (chunk) => {
            data += chunk;
          });

          resp.on("end", () => {
            data = JSON.parse(data);

            if (data.error) {
              if (/"token_expired"/i.test(data.error.description)) {
                this.refreshToken((err, data) => {
                  if (err) {
                    return reject(err);
                  }

                  return this.api(method, url, postData);
                });
              } else {
                return reject(data.error);
              }
            }

            return resolve(data);
          });
        })
        .on("error", (err) => {
          return reject(err.message);
        })
        .end();
    });
  }
}

export default YahooFantasy;
