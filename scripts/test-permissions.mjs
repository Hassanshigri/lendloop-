// Checks that role and ownership rules are enforced by Convex functions, not the UI.
// Runs functions as the two seeded users via the Convex CLI's --identity flag.
//   npx convex dev   (local)   then   npx convex run seed:demo   then   node scripts/test-permissions.mjs
import { execFileSync } from "node:child_process";

const as = (who) =>
  JSON.stringify({ tokenIdentifier: `seed|${who}`, subject: who, issuer: "seed", name: who });

function run(fn, args = {}, who) {
  // Call the Convex CLI through node directly so JSON arguments survive on every OS shell.
  const cli = ["node_modules/convex/bin/main.js", "run", fn, JSON.stringify(args)];
  if (who) cli.push("--identity", as(who));
  try {
    const out = execFileSync(process.execPath, cli, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, value: out.trim() ? JSON.parse(out) : null };
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message) };
  }
}

let failures = 0;
function expectDenied(label, result, text) {
  const ok = !result.ok && result.error.includes(text);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { failures++; console.log("      ", result.ok ? "call was allowed" : result.error.split("\n").slice(-3).join(" ")); }
}
function expectAllowed(label, result) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${label}`);
  if (!result.ok) { failures++; console.log("      ", result.error.split("\n").slice(-3).join(" ")); }
  return result.value;
}

const anaTools = expectAllowed("Ana can read her listings", run("tools:myListings", {}, "ana"));
const benTools = expectAllowed("Ben can read his listings", run("tools:myListings", {}, "ben"));
const drill = anaTools.find((t) => t.name === "Cordless drill");
const tent = benTools.find((t) => t.name === "4-person tent");

expectDenied("signed-out user cannot browse member data", run("tools:listForMembers", {}), "signed in");
expectDenied("Ben cannot edit Ana's listing", run("tools:update", {
  toolId: drill._id, name: "Mine now", category: "power tools", condition: "good", description: "x",
}, "ben"), "your own listings");
expectDenied("Ana cannot delete Ben's listing (not admin)", run("tools:remove", { toolId: tent._id }, "ana"), "your own listings");
expectDenied("Ben cannot borrow his own tent", run("tools:listForMembers", {}, "ben").ok
  ? run("loans:request", { toolId: tent._id, startDate: "2099-01-01", endDate: "2099-01-03" }, "ben")
  : { ok: true }, "your own tool");
expectDenied("non-admin cannot list users", run("users:listForAdmin", {}, "ben"), "Admins only");
expectDenied("non-admin cannot mark Trusted Lender", run("users:setTrustedLender", { userId: drill.ownerId, trusted: false }, "ben"), "Admins only");
expectDenied("non-admin cannot view all loans", run("loans:allForAdmin", {}, "ana"), "Admins only");

const loanId = expectAllowed("Ana can request Ben's tent", run("loans:request", { toolId: tent._id, startDate: "2099-01-01", endDate: "2099-01-03" }, "ana"));
expectDenied("borrower cannot approve their own request", run("loans:approve", { loanId }, "ana"), "owner can approve");
expectDenied("past start dates are rejected", run("loans:request", { toolId: drill._id, startDate: "2000-01-01", endDate: "2000-01-02" }, "ben"), "past");
expectAllowed("Ben (owner) can approve the request", run("loans:approve", { loanId }, "ben"));
expectDenied("Ana cannot mark Ben's tool returned", run("loans:markReturned", { loanId }, "ana"), "owner can mark");
expectAllowed("Ben can mark it returned", run("loans:markReturned", { loanId }, "ben"));

// Admin: role comes from ADMIN_EMAILS on the server, never from the client.
execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "env", "set", "ADMIN_EMAILS", "admin@example.com"], { stdio: "ignore" });
const adminId = JSON.stringify({ tokenIdentifier: "seed|admin", subject: "admin", issuer: "seed", name: "Ada Admin", email: "admin@example.com" });
const asAdmin = (fn, args) => {
  try {
    const out = execFileSync(process.execPath, ["node_modules/convex/bin/main.js", "run", fn, JSON.stringify(args), "--identity", adminId], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, value: out.trim() ? JSON.parse(out) : null };
  } catch (e) { return { ok: false, error: String(e.stderr || e.message) }; }
};
expectAllowed("admin email gets the admin role on sign-in", asAdmin("users:store", {}));
expectAllowed("admin can list all loans", asAdmin("loans:allForAdmin", {}));
expectAllowed("admin can mark a Trusted Lender", asAdmin("users:setTrustedLender", { userId: tent.ownerId, trusted: true }));
expectDenied("admin cannot rewrite someone else's listing", asAdmin("tools:update", {
  toolId: tent._id, name: "x", category: "camping", condition: "good", description: "x",
}), "your own listings");
expectAllowed("admin can remove any listing", asAdmin("tools:remove", { toolId: tent._id }));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll permission checks passed");
process.exit(failures ? 1 : 0);
