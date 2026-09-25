// Regenera os efeitos sonoros e as falas do rádio com a API do ElevenLabs.
// Uso: ELEVENLABS_API_KEY=... npm run sfx   (arquivos vão para client/public/sfx)
import { mkdir, writeFile } from 'node:fs/promises';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('Defina ELEVENLABS_API_KEY'); process.exit(1); }
const OUT = new URL('../client/public/sfx/', import.meta.url);
const VOICE = process.env.RADIO_VOICE_ID || 'jkiD8IhCU1i2V7VvmNwi'; // "Randel - Deep Epic" (pt-BR)

const SFX = {
  rifle: 'Single assault rifle gunshot, punchy and tight, indoor room, close mic, very short, one shot only',
  pump: 'Single pump-action shotgun blast, heavy boomy low end, indoor, one shot only, short',
  sniper: 'Single bolt-action sniper rifle shot, loud sharp crack with short room echo, one shot only',
  melee: 'Fast cat claw swipe scratch whoosh, aggressive short hiss, one swipe',
  reload: 'Rifle magazine reload: mag out click, mag in slap, charging handle pull, dry foley',
  hurt: 'Short angry cat meow of pain, surprised yelp, single meow',
  death: 'Dramatic cartoon cat death yowl, long descending sad meow',
  purr: 'Close-up cat purring, steady content loud purr, seamless loop',
  radio: 'Military radio squelch click and short static burst, walkie talkie beep',
  win: 'Short triumphant military brass victory fanfare sting',
  lose: 'Short sad descending trombone defeat sting, comedic wah wah',
  slide: 'Quick fabric slide whoosh on wooden floor, sliding into cover',
};
const RADIO = [
  'Bravo Six, going meow.', 'Contato! Gato inimigo à vista!', 'Preciso de cobertura, miau!',
  'Área limpa. Hora da soneca.', 'Na caixa! Todos na caixa!', 'Recuar para o sofá!',
];

async function post(url, body, file) {
  const res = await fetch(url, { method: 'POST', headers: { 'xi-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} ${await res.text()}`);
  await writeFile(new URL(file, OUT), Buffer.from(await res.arrayBuffer()));
  console.log('✓', file);
}

await mkdir(OUT, { recursive: true });
for (const [name, text] of Object.entries(SFX)) {
  await post('https://api.elevenlabs.io/v1/sound-generation', { text, model_id: 'eleven_text_to_sound_v2', loop: name === 'purr' }, `${name}.mp3`);
}
for (const [i, text] of RADIO.entries()) {
  await post(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, { text, model_id: 'eleven_multilingual_v2' }, `radio_${i}.mp3`);
}
