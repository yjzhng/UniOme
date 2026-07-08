// electron-builder afterPack hook — give the packaged .app a VALID ad-hoc signature.
//
// Why: we distribute unsigned (no Apple Developer ID). But electron-builder's default output leaves the
// outer bundle with a broken/partial signature ("code has no resources but signature indicates they must
// be present"), which macOS treats as tampered → the scary "'UniOme' is damaged and can't be opened.
// Move it to the Trash." dialog on a quarantined download. A *valid* ad-hoc signature instead yields the
// friendly "unidentified developer / Apple can't check for malware" dialog, whose GUI "Open Anyway" flow
// works with no Terminal. (Apple Silicon also *requires* a signature to run at all, so truly-unsigned is
// not an option — a clean ad-hoc sign is the correct state for unsigned distribution.)
//
// `codesign --sign -` is ad-hoc; --force overwrites the partial signature; --deep signs nested code
// (Electron framework, helpers) so the whole bundle verifies.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]); // fail the build if it's not valid
  console.log(`  • ad-hoc signed + verified ${path.basename(app)}`);
};
