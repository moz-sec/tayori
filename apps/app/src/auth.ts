import { createRemoteJWKSet, jwtVerify } from "jose";

type AccessBinding = Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD" | "ALLOWED_EMAIL">;

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export type AuthResult =
  | { ok: true; principal: string }
  | { ok: false; status: 401 | 403 | 503; code: string };

export async function authenticate(request: Request, env: AccessBinding): Promise<AuthResult> {
  const url = new URL(request.url);
  if (isLocalDevelopmentHost(url.hostname)) {
    return { ok: true, principal: "local@tayori" };
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  const allowedEmail = env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!teamDomain || !audience || !allowedEmail) {
    return { ok: false, status: 503, code: "ACCESS_NOT_CONFIGURED" };
  }

  const issuerUrl = normalizeAccessIssuer(teamDomain);
  if (!issuerUrl) return { ok: false, status: 503, code: "ACCESS_NOT_CONFIGURED" };

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || token.length > 16_384) {
    return { ok: false, status: 401, code: "AUTHENTICATION_REQUIRED" };
  }

  try {
    const jwks = getJwks(issuerUrl);
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: issuerUrl,
      audience,
      clockTolerance: 5,
    });
    if (typeof payload.email !== "string") {
      return { ok: false, status: 401, code: "INVALID_ACCESS_TOKEN" };
    }
    if (payload.email.toLowerCase() !== allowedEmail) {
      return { ok: false, status: 403, code: "ACCOUNT_NOT_ALLOWED" };
    }
    return { ok: true, principal: payload.email };
  } catch {
    return { ok: false, status: 401, code: "INVALID_ACCESS_TOKEN" };
  }
}

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksByIssuer.get(issuer);
  if (cached) return cached;
  const url = new URL("/cdn-cgi/access/certs", issuer);
  const jwks = createRemoteJWKSet(url);
  jwksByIssuer.set(issuer, jwks);
  return jwks;
}

function normalizeAccessIssuer(teamDomain: string): string | null {
  try {
    const candidate = teamDomain.includes("://") ? teamDomain : `https://${teamDomain}`;
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
