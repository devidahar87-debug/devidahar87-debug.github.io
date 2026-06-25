import os
import json
from pathlib import Path


def generate_playlist():
    audio_dir = Path('assets/audio')
    audio_extensions = {'.mp3', '.mpeg', '.wav', '.ogg', '.aac', '.m4a'}

    audio_files = []
    for file in audio_dir.iterdir():
        if file.is_file():
            if file.name == 'playlist.json' or file.name == 'json':
                continue
            if file.suffix.lower() in audio_extensions:
                audio_files.append(file.name)

    audio_files.sort()

    output_file = audio_dir / 'playlist.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(audio_files, f, indent=2, ensure_ascii=False)

    print(f"✅ Playlist generated successfully!")
    print(f"📁 Location: {output_file}")
    print(f"🎵 Total tracks: {len(audio_files)}")
    print("\n📋 Track list:")
    for i, file in enumerate(audio_files, 1):
        print(f"  {i:2d}. {file}")

    return audio_files


if __name__ == "__main__":
    generate_playlist()