"""Compose Night Shift: original 8-bar synth loop, 100 BPM. Requires numpy."""
from pathlib import Path
import wave
import numpy as np

rate = 32000
beat = .6
duration = 32 * beat
n = round(rate * duration)
audio = np.zeros((n, 2))

def note(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def add(start, samples, pan=0):
    k = round(start * rate)
    count = min(len(samples), n-k)
    audio[k:k+count, 0] += samples[:count] * (1-pan*.4)
    audio[k:k+count, 1] += samples[:count] * (1+pan*.4)

chords = [(45,52,57,60), (41,48,53,57), (48,55,60,64), (43,50,55,59)]
for bar in range(8):
    chord = chords[bar//2]
    t = np.arange(round(4*beat*rate))/rate
    envelope = np.minimum(t/.16, 1) * np.minimum((4*beat-t)/.3, 1)
    pad = sum(np.sin(2*np.pi*note(m)*t) for m in chord) * .034 * envelope
    add(bar*4*beat, pad, (-1 if bar%2 else 1)*.3)
    for step in range(8):
        t = np.arange(round(.26*rate))/rate
        freq = note(chord[(step+bar)%4]+12)
        pluck = (np.sin(2*np.pi*freq*t)+.18*np.sin(4*np.pi*freq*t))*np.exp(-t*15)*np.minimum(t/.008,1)*.10
        add((bar*4+step/2)*beat, pluck, .7 if step%2 else -.7)
    for pulse in range(4):
        t = np.arange(round(.42*rate))/rate
        bass = np.sin(2*np.pi*note(chord[0]-12)*t)*np.exp(-t*6)*np.minimum(t/.01,1)*.15
        add((bar*4+pulse)*beat, bass)
        t = np.arange(round(.2*rate))/rate
        kick = np.sin(2*np.pi*(46*t+6*(1-np.exp(-t*35))))*np.exp(-t*24)*.18
        add((bar*4+pulse)*beat, kick)
        t = np.arange(round(.065*rate))/rate
        hat = (np.sin(2*np.pi*7310*t)+np.sin(2*np.pi*9410*t))*np.exp(-t*65)*.025
        add((bar*4+pulse+.5)*beat, hat, .4)

fade = np.minimum(np.arange(n)/(rate*.015),1)*np.minimum((n-1-np.arange(n))/(rate*.025),1)
audio *= fade[:,None]
audio = np.clip(audio, -.95, .95)
path = Path(__file__).resolve().parents[1]/'assets/audio/night-shift.wav'
with wave.open(str(path),'wb') as out:
    out.setnchannels(2); out.setsampwidth(2); out.setframerate(rate)
    out.writeframes((audio*32767).astype('<i2').tobytes())
print(f'{path.name}: {duration:.1f}s stereo; peak={np.max(np.abs(audio)):.3f}, rms={np.sqrt(np.mean(audio**2)):.3f}')
