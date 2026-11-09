// Embed icon + version info into ModCut.exe without Wine (pure-JS PE resource editing)
const fs = require('fs');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const data = fs.readFileSync(exe);
  const pe = R.NtExecutable.from(data, { ignoreCert: true });
  const res = R.NtExecutableResource.from(pe);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0];
  if (vi) {
    const v = ctx.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0], v[1], v[2], 0); vi.setProductVersion(v[0], v[1], v[2], 0);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'ModCut', FileDescription: 'ModCut — 3D model cutter', CompanyName: 'ModCut', OriginalFilename: 'ModCut.exe', InternalName: 'ModCut', LegalCopyright: '' });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log('  • embedded icon/version into', path.basename(exe));
};
