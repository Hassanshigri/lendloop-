// Convex validates Clerk-issued JWTs. Set CLERK_JWT_ISSUER_DOMAIN in the Convex
// dashboard (Settings > Environment Variables) to your Clerk Frontend API URL.
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
