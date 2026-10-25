import { writeFileSync } from 'node:fs';
const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs>${defs}<filter id="glow"><feGaussianBlur stdDeviation="4"/></filter><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#0b1127"/><stop offset=".65" stop-color="#26325a"/><stop offset="1" stop-color="#657190"/></linearGradient><linearGradient id="road" x2="0" y2="1"><stop stop-color="#121b32"/><stop offset="1" stop-color="#080c18"/></linearGradient></defs>${body}</svg>`;
let buildings = '';
for (let i = 0; i < 46; i++) {
  const x = i * 39;
  const h = 70 + ((i * 151 + 77) % 215);
  buildings += `<rect x="${x}" y="${520 - h}" width="${25 + (i % 4) * 7}" height="${h}" fill="${i % 3 === 0 ? '#111a32' : '#18223d'}"/><path d="M${x + 2} ${520 - h}h${21 + (i % 4) * 7}" stroke="#657bba" stroke-opacity=".5"/>`;
  for (let r = 0; r < Math.floor(h / 18); r++)
    for (let c = 0; c < 3; c++)
      if ((i + r + c) % 3 !== 0)
        buildings += `<rect x="${x + 5 + c * 8}" y="${528 - h + r * 18}" width="2" height="5" fill="${i % 4 === 0 ? '#81c9d6' : '#68789f'}" opacity=".5"/>`;
}
const car = `<g transform="translate(935 610) rotate(-7)"><ellipse cx="164" cy="172" rx="240" ry="34" fill="#000" opacity=".6"/><ellipse cx="169" cy="180" rx="190" ry="26" fill="#607dff" opacity=".25" filter="url(#glow)"/><path d="M-55 95L-20 38 82 4 238 5 330 50 380 105 363 158 22 170-54 142Z" fill="url(#metal)" stroke="#7f99bd" stroke-width="2"/><path d="M-20 39L82 4 238 5 330 50 102 68Z" fill="#233151"/><path d="M86 14L224 15 294 48 106 57 31 42Z" fill="#0b1327" stroke="#4b6488" stroke-width="2"/><path d="M111 17L121 53M228 20L247 49" stroke="#577191" stroke-width="3"/><path d="M-55 95L103 116 380 105 363 158 22 170-54 142Z" fill="url(#rear)"/><path d="M-38 101L99 120 352 110" fill="none" stroke="#ff304e" stroke-width="9" filter="url(#glow)"/><path d="M-38 101L99 120 352 110" fill="none" stroke="#ff6075" stroke-width="4"/><path d="M-53 92L93 110 366 101 374 107 97 121-56 101Z" fill="#131c31" stroke="#6980a1"/><rect x="156" y="131" width="71" height="17" rx="2" fill="#b4c7d9"/><path d="M28 153L94 160 327 148" fill="none" stroke="#070c17" stroke-width="10"/><ellipse cx="11" cy="142" rx="24" ry="42" fill="#060910"/><ellipse cx="14" cy="143" rx="12" ry="29" fill="#283349"/><ellipse cx="326" cy="137" rx="19" ry="36" fill="#060910"/><ellipse cx="328" cy="137" rx="10" ry="25" fill="#29384f"/><path d="M69 72L314 58M82 80L333 72" stroke="#8da6ca" stroke-opacity=".36"/><path d="M278 157h23m-265 9h25" stroke="#a0c7ea" stroke-width="7"/><path d="M100 74L115 104" stroke="#9aaac1" opacity=".4"/></g>`;
const midnight = svg(
  `<rect width="1600" height="1000" fill="url(#sky)"/><circle cx="1195" cy="185" r="85" fill="#c2cadb" opacity=".05"/><circle cx="1195" cy="185" r="54" fill="#d3dbe8" opacity=".8"/><path d="M0 410Q460 330 800 445T1600 395V565H0Z" fill="#1a2541"/>${buildings}<path d="M0 550L882 480 1600 560V1000H0Z" fill="url(#road)"/><path d="M877 481L400 1000M905 481L1600 1000" stroke="#4a628d" stroke-width="5"/><path d="M876 485L365 1000M911 485L1600 965" stroke="#86a5f5" opacity=".6" stroke-width="2"/><path d="M888 515L896 546M901 575L918 624M935 677L967 767M1002 846L1070 1000" stroke="#b7c7e1" stroke-width="7" opacity=".5"/><path d="M20 650L660 540M0 800L679 560M1590 720L1060 534" stroke="#4b62a0" stroke-width="2" opacity=".2"/><path d="M1420 510V285m0 8h-77" stroke="#586987" stroke-width="6"/><path d="M1417 296h-70" stroke="#d1e9fb" stroke-width="3"/><path d="M1344 300L1190 728H1540Z" fill="#9cbbef" opacity=".025"/>${car}<rect width="1600" height="1000" fill="url(#vignette)"/>`,
  `<linearGradient id="metal" x2=".5" y2="1"><stop stop-color="#b3c1d3"/><stop offset=".4" stop-color="#506989"/><stop offset="1" stop-color="#17243a"/></linearGradient><linearGradient id="rear" x2="0" y2="1"><stop stop-color="#3d536f"/><stop offset="1" stop-color="#111c30"/></linearGradient><radialGradient id="vignette"><stop offset=".25" stop-color="#080b16" stop-opacity="0"/><stop offset="1" stop-color="#080b16" stop-opacity=".65"/></radialGradient>`,
);
const orbital = svg(
  `<rect width="1600" height="1000" fill="#080c19"/>${Array.from({ length: 140 }, (_, i) => `<circle cx="${(i * 311) % 1600}" cy="${(i * 179) % 1000}" r="${i % 3 === 0 ? 1.5 : 0.7}" fill="#a4b2cf" opacity="${0.2 + (i % 5) / 10}"/>`).join('')}<circle cx="980" cy="490" r="330" fill="url(#planet)"/><ellipse cx="980" cy="490" rx="570" ry="95" fill="none" stroke="#b6b3af" stroke-width="34" opacity=".28" transform="rotate(-27 980 490)"/><ellipse cx="980" cy="490" rx="570" ry="95" fill="none" stroke="#d8c6aa" stroke-width="2" opacity=".7" transform="rotate(-27 980 490)"/><path d="M750 840L820 805 850 823 822 845 780 852Z" fill="#7385a4"/><path d="M800 842L742 870" stroke="#83d9fa" stroke-width="5" filter="url(#glow)"/>`,
  `<radialGradient id="planet" cx=".25" cy=".2"><stop stop-color="#c3b3a6"/><stop offset=".3" stop-color="#7f8291"/><stop offset=".7" stop-color="#333e5c"/><stop offset="1" stop-color="#080d1c"/></radialGradient>`,
);
let trees = '';
for (let i = 0; i < 42; i++) {
  const x = (i * 173) % 1600;
  const h = 250 + ((i * 79) % 500);
  trees += `<path d="M${x} 950V${950 - h}" stroke="${i % 2 ? '#122e30' : '#0c2229'}" stroke-width="${22 + (i % 21)}"/><path d="M${x - 75} ${980 - h}L${x} ${640 - h}L${x + 90} ${980 - h}Z" fill="${i % 2 ? '#183e3b' : '#153333'}"/>`;
}
const evergreen = svg(
  `<rect width="1600" height="1000" fill="url(#forest)"/><circle cx="920" cy="330" r="155" fill="#d3c999" opacity=".4"/><path d="M0 500Q350 250 800 450T1600 350V1000H0Z" fill="#33504c"/>${trees}<path d="M770 1000Q1020 780 950 590L1000 590Q1080 740 1200 1000Z" fill="#81988b" opacity=".3"/><path d="M920 682v66" stroke="#e5d7a3" stroke-width="7"/><circle cx="920" cy="671" r="9" fill="#e5d7a3"/><path d="M918 706l-18 27m24-27l17 21" stroke="#e5d7a3" stroke-width="4"/>`,
  `<linearGradient id="forest" x2="0" y2="1"><stop stop-color="#607772"/><stop offset=".5" stop-color="#3b5d55"/><stop offset="1" stop-color="#0b242c"/></linearGradient>`,
);
const echoes = svg(
  `<rect width="1600" height="1000" fill="#17152c"/><circle cx="960" cy="400" r="255" fill="url(#sun)"/><path d="M0 890L790 500 1600 910V1000H0Z" fill="#232137"/><path d="M720 730L900 630 1075 733 895 835Z" fill="#77718c"/><path d="M720 730V493L895 593V835Z" fill="#47445e"/><path d="M895 593L1075 490V733L895 835Z" fill="#37344f"/><path d="M720 493L900 390 1075 490 895 593Z" fill="#c2b1c1"/><path d="M901 390V286m-13 100V286" stroke="#f3c6a2" stroke-width="3"/><path d="M906 286L1290 90M883 286L465 85" stroke="#edb995" stroke-width="4"/><ellipse cx="898" cy="286" rx="22" ry="12" fill="#ffdbb4" filter="url(#glow)"/><path d="M0 950L790 600M1600 950L1000 600M300 1000L850 600M1350 1000L950 600" stroke="#c3abaf" stroke-opacity=".12"/>`,
  `<radialGradient id="sun"><stop stop-color="#c39e9e" stop-opacity=".4"/><stop offset="1" stop-color="#c39e9e" stop-opacity="0"/></radialGradient>`,
);
for (const [name, content] of Object.entries({ midnight, orbital, evergreen, echoes }))
  for (const shape of ['cover', 'banner'])
    writeFileSync(`public/art/${name}-${shape}.svg`, content);
console.log('Eight original SVG artworks generated.');
