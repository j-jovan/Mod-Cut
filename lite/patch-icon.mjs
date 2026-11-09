// Embed the ModCut icon + version info into the Neutralino Windows runtime (pure JS, no Wine).
import fs from 'fs';
import * as R0 from 'resedit';
const R = R0.default || R0;
const here = new URL('.', import.meta.url).pathname;
const pe = R.NtExecutable.from(fs.readFileSync(here + 'bin/neutralino-win_x64.orig.exe'), { ignoreCert: true });
const res = R.NtExecutableResource.from(pe);
const ico = R.Data.IconFile.from(fs.readFileSync(here + '../icon.ico'));
const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups.length ? groups[0].id : 1, groups.length ? groups[0].lang : 1033, ico.icons.map((i) => i.data));
const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
vi.lang = 1033;
vi.setFileVersion(1, 1, 0, 0); vi.setProductVersion(1, 1, 0, 0);
vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: 'ModCut', FileDescription: 'ModCut - 3D model cutter', CompanyName: 'ModCut', OriginalFilename: 'ModCut.exe', InternalName: 'ModCut', FileVersion: '1.1.0', ProductVersion: '1.1.0' });
vi.outputToResourceEntries(res.entries);
res.outputResource(pe);
fs.writeFileSync(here + 'bin/neutralino-win_x64.exe', Buffer.from(pe.generate()));
console.log('patched icon');
