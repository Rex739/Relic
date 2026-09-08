import { auditHealthGuardReadiness } from "./readiness-audit.js";
import { VenusMainnetHealthReader } from "./venus-reader.js";

const report = await auditHealthGuardReadiness(process.env, async (config) => {
  await new VenusMainnetHealthReader(config).verifyDeployment();
});
console.info(JSON.stringify(report));
process.exitCode = report.ready ? 0 : 1;
