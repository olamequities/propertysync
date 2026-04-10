# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_submodules

sb_datas, sb_binaries, sb_hiddenimports = collect_all('seleniumbase')
sel_datas, sel_binaries, sel_hiddenimports = collect_all('selenium')

a = Analysis(
    ['scripts\\estate-scanner.py'],
    pathex=[],
    binaries=sb_binaries + sel_binaries,
    datas=sb_datas + sel_datas,
    hiddenimports=sb_hiddenimports + sel_hiddenimports + [
        'certifi',
        'charset_normalizer',
        'urllib3',
        'requests',
        'websocket',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='estate-scanner',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
