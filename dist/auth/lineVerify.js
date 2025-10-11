"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyLineIdToken = verifyLineIdToken;
const jose_1 = require("jose");
const index_js_1 = require("../config/index.js");
const LINE_JWKS = (0, jose_1.createRemoteJWKSet)(new URL('https://api.line.me/oauth2/v2.1/certs'));
async function verifyLineIdToken(idToken) {
    return await (0, jose_1.jwtVerify)(idToken, LINE_JWKS, {
        issuer: index_js_1.config.line.issuer,
        audience: index_js_1.config.line.channelId,
        clockTolerance: 300,
    });
}
