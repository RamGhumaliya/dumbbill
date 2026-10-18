"""
Converts the web app's self-hosted .woff2 fonts into .ttf files for Flutter.

Why: Flutter cannot load .woff2 (it needs .ttf/.otf), but the web app already ships the exact fonts we chose,
as woff2, in ../dumbbill-web/src/fonts. Converting THOSE files means both apps use byte-for-byte the same fonts.

Each font comes as two files, "latin" (letters, digits) and "latin-ext" (extra characters). Flutter has no
per-character font files, so they become two families, tied together with `fontFamilyFallback` in the theme
(see lib/core/theme/app_typography.dart). Only Inter Tight has the rupee sign (U+20B9).

Run only when fonts change:   python tool/convert_fonts.py     (needs: pip install fonttools brotli)
The result (assets/fonts/*.ttf) is committed.
"""
import pathlib
import shutil

from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'dumbbill-web' / 'src' / 'fonts'
TARGET = ROOT / 'assets' / 'fonts'
TARGET.mkdir(parents=True, exist_ok=True)

# source file (without .woff2) -> output name
FONTS = {
    'inter-tight-latin-wght-normal': 'InterTight-Variable',
    'inter-tight-latin-ext-wght-normal': 'InterTightExt-Variable',
    'jetbrains-mono-latin-wght-normal': 'JetBrainsMono-Variable',
    'jetbrains-mono-latin-ext-wght-normal': 'JetBrainsMonoExt-Variable',
    'barlow-condensed-latin-500-normal': 'BarlowCondensed-Medium',
    'barlow-condensed-latin-600-normal': 'BarlowCondensed-SemiBold',
    'barlow-condensed-latin-700-normal': 'BarlowCondensed-Bold',
    'barlow-condensed-latin-ext-500-normal': 'BarlowCondensedExt-Medium',
    'barlow-condensed-latin-ext-600-normal': 'BarlowCondensedExt-SemiBold',
    'barlow-condensed-latin-ext-700-normal': 'BarlowCondensedExt-Bold',
}

for source_name, output_name in FONTS.items():
    font = TTFont(SOURCE / f'{source_name}.woff2')
    font.flavor = None  # plain TrueType instead of WOFF2
    font.save(TARGET / f'{output_name}.ttf')
    axes = [axis.axisTag for axis in font['fvar'].axes] if 'fvar' in font else []
    print(f'{output_name}.ttf  axes={axes or "none"}  glyphs={len(font.getBestCmap())}')

# The fonts are licensed under the SIL Open Font License, which requires shipping the licence text.
licenses = TARGET / 'licenses'
licenses.mkdir(exist_ok=True)
for licence in (SOURCE / 'licenses').glob('*.txt'):
    shutil.copy(licence, licenses / licence.name)
print('licences copied')
