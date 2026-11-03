#!/usr/bin/env python3
"""Build short game cues from the Freesound HQ previews listed in sources.json.

Download the listed fs:<id> keys with the sound skill, then run:
  python3 tools/audio/build.py /path/to/downloaded/previews
Requires ffmpeg; does not contact an API or touch browser storage.
"""
import array
import hashlib
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web/assets/audio'
RECIPES = Path(__file__).with_name('recipes.json')


def run(args):
    return subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args])


def build(source_dir):
    recipes = json.loads(RECIPES.read_text())
    sources = {r['key']: r for r in json.loads((OUT / 'sources.json').read_text())}
    records = []
    with tempfile.TemporaryDirectory(prefix='aitank-audio-') as scratch:
        for recipe in recipes:
            layers = recipe.get('layers', [recipe])
            clips = []
            for number, layer in enumerate(layers):
                sid = layer['source']
                if sources[sid]['license'] != 'CC0':
                    raise ValueError('Unreviewed license: ' + sid)
                raw = next(source_dir.glob('fs_' + sid.split(':')[1] + '_*.mp3'))
                if hashlib.sha256(raw.read_bytes()).hexdigest() != sources[sid]['sha256']:
                    raise ValueError('Source preview changed: ' + sid)
                filters = [f"atrim=start={layer.get('start', 0)}:duration={layer['take']}",
                           'asetpts=PTS-STARTPTS', 'aresample=44100',
                           'silenceremove=start_periods=1:start_duration=0.003:start_threshold=-48dB']
                if layer.get('reverse'):
                    filters += ['areverse']
                if layer.get('rate', 1) != 1:
                    filters += [f"asetrate={44100 * layer['rate']}", 'aresample=44100']
                filters += layer.get('filters', [])
                filters += [f"volume={layer.get('gain', 1)}"]
                clip = Path(scratch) / f'{number}.wav'
                run(['-i', str(raw), '-af', ','.join(filters), '-ac', '1', '-c:a', 'pcm_f32le', str(clip)])
                clips.append(clip)
            duration = recipe['duration']
            filters = ['highpass=f=45', 'lowpass=f=11000',
                       'acompressor=threshold=0.35:ratio=3:attack=2:release=70',
                       'apad', f'atrim=duration={duration}']
            if recipe.get('loop'):
                # Short fades at the loop seam avoid boundary clicks.
                filters += ['afade=t=in:d=0.03', f'afade=t=out:st={duration - .03}:d=0.03']
            else:
                tail = min(.12, duration * .32)
                filters += ['afade=t=in:d=0.003', f'afade=t=out:st={duration - tail}:d={tail}']
            inputs = [part for clip in clips for part in ['-i', str(clip)]]
            graph = ''.join(f'[{i}:a]' for i in range(len(clips)))
            graph += f'amix=inputs={len(clips)}:normalize=0:duration=longest,' + ','.join(filters)
            pcm = run([*inputs, '-filter_complex', graph, '-ar', '44100', '-ac', '1', '-f', 'f32le', '-'])
            samples = array.array('f'); samples.frombytes(pcm)
            peak = max(map(abs, samples), default=0)
            if peak < 1e-5:
                raise ValueError('Silent cue: ' + recipe['id'])
            scale = 10 ** (-4 / 20) / peak
            floats = Path(scratch) / 'mixed.f32'
            floats.write_bytes(pcm)
            target = OUT / (recipe['id'] + '.mp3')
            run(['-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', str(floats),
                 '-af', f'volume={scale}', '-c:a', 'libmp3lame', '-b:a', '96k',
                 '-map_metadata', '-1', str(target)])
            decoded = array.array('f'); decoded.frombytes(run(['-i', str(target), '-ac', '1', '-ar', '44100', '-f', 'f32le', '-']))
            rms = math.sqrt(sum(x * x for x in decoded) / len(decoded))
            record = {'id': recipe['id'], 'file': target.name, 'seconds': round(len(decoded) / 44100, 4),
                      'peak': round(max(map(abs, decoded)), 5), 'rms': round(rms, 5),
                      'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                      'sources': list(dict.fromkeys(layer['source'] for layer in layers)), 'loop': recipe.get('loop', False)}
            if record['peak'] >= .95 or rms < .001:
                raise ValueError('Cue level out of bounds: ' + str(record))
            records.append(record)
    (OUT / 'manifest.json').write_text(json.dumps({'version': 2, 'style': 'soft-arcade', 'format': 'MP3 44.1 kHz mono / 96 kbps',
        'license': 'CC0-1.0', 'build': 'tools/audio/build.py + recipes.json', 'clips': records}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'clips': len(records), 'bytes': sum(r['bytes'] for r in records), 'maxPeak': max(r['peak'] for r in records)}))


if __name__ == '__main__':
    build(Path(sys.argv[1]).resolve())
