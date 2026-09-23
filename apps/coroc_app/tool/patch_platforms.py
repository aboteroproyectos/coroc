#!/usr/bin/env python3
"""Ajusta las carpetas nativas que genera `flutter create` a lo que COROC necesita (§7, ADR-023).

Uso, desde apps/coroc_app:
    flutter create --platforms=android,ios,macos,windows --org co.coroc --project-name coroc .
    python3 tool/patch_platforms.py

Es idempotente y funciona igual en Linux, macOS y Windows (solo usa la biblioteca estándar).
"""
import pathlib
import plistlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent


def edit(rel, fn):
    p = ROOT / rel
    if p.exists():
        before = p.read_text(encoding='utf-8')
        after = fn(before)
        if after != before:
            p.write_text(after, encoding='utf-8')
        return True
    return False


def plist(rel, updates):
    p = ROOT / rel
    if p.exists():
        data = plistlib.loads(p.read_bytes())
        data.update(updates)
        p.write_bytes(plistlib.dumps(data))


# ─── Android ───
def manifest(text):
    for perm in ('INTERNET', 'USE_BIOMETRIC'):
        if f'android.permission.{perm}' not in text:
            text = text.replace('<application', f'<uses-permission android:name="android.permission.{perm}"/>\n    <application', 1)
    text = re.sub(r'android:label="[^"]*"', 'android:label="COROC"', text, count=1)
    # Sin copia automática en la nube: el almacén seguro no debe restaurarse en otro equipo.
    if 'android:allowBackup' not in text:
        text = re.sub(r'<application(\s)', r'<application\n        android:allowBackup="false"\n        android:fullBackupContent="false"\1', text, count=1)
    return text


edit('android/app/src/main/AndroidManifest.xml', manifest)

# local_auth exige FragmentActivity; FLAG_SECURE impide capturas y oculta el contenido en el selector de tareas (§7.3).
for activity in (ROOT / 'android/app/src/main').rglob('MainActivity.kt'):
    pkg = re.search(r'^package (.+)$', activity.read_text(encoding='utf-8'), re.M).group(1)
    activity.write_text(f'''package {pkg}

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity

class MainActivity : FlutterFragmentActivity() {{
    override fun onCreate(savedInstanceState: Bundle?) {{
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }}
}}
''', encoding='utf-8')

# Android 8.0 (API 26) o superior.
for g in ('android/app/build.gradle.kts', 'android/app/build.gradle'):
    edit(g, lambda t: re.sub(r'minSdk(Version)?(\s*=\s*|\s+)(flutter\.minSdkVersion|\d+)', lambda m: f'minSdk{m.group(1) or ""}{m.group(2)}26', t))

# ─── iOS ───
plist('ios/Runner/Info.plist', {
    'CFBundleDisplayName': 'COROC',
    'NSFaceIDUsageDescription': 'COROC usa Face ID para desbloquear la app sin escribir la contraseña.',
    'CFBundleLocalizations': ['es', 'pt-BR', 'en'],
    'CFBundleDevelopmentRegion': 'es',
    'ITSAppUsesNonExemptEncryption': False,
})


def deployment(key, version):
    return lambda t: re.sub(rf'{key} = [0-9.]+;', f'{key} = {version};', t)


def podfile(platform, version):
    def fn(t):
        t2 = re.sub(rf"^#?\s*platform :{platform}, '[0-9.]+'", f"platform :{platform}, '{version}'", t, flags=re.M)
        return t2 if f"platform :{platform}," in t2 else f"platform :{platform}, '{version}'\n" + t2
    return fn


edit('ios/Runner.xcodeproj/project.pbxproj', deployment('IPHONEOS_DEPLOYMENT_TARGET', '16.0'))
edit('ios/Podfile', podfile('ios', '16.0'))

# ─── macOS ───
plist('macos/Runner/Info.plist', {'CFBundleLocalizations': ['es', 'pt-BR', 'en'], 'CFBundleDevelopmentRegion': 'es'})
for f in ('macos/Runner/DebugProfile.entitlements', 'macos/Runner/Release.entitlements'):
    plist(f, {'com.apple.security.network.client': True})
edit('macos/Runner.xcodeproj/project.pbxproj', deployment('MACOSX_DEPLOYMENT_TARGET', '13.0'))
edit('macos/Podfile', podfile('osx', '13.0'))
edit('macos/Runner/Configs/AppInfo.xcconfig', lambda t: re.sub(r'^PRODUCT_NAME = .*$', 'PRODUCT_NAME = COROC', t, flags=re.M))

# ─── Windows ───
edit('windows/runner/main.cpp', lambda t: re.sub(r'window\.Create\(L"[^"]*"', 'window.Create(L"COROC"', t))


# local_auth_windows (hasta 2.0.2) compila con /await y <experimental/coroutine>, que MSVC 14.51+ rechaza (STL1011)
# salvo que se defina esta macro. Se agrega antes de incluir los complementos para que les aplique.
SILENCE = '_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS'
edit('windows/CMakeLists.txt', lambda t: t if SILENCE in t else t.replace(
    'add_definitions(-DUNICODE -D_UNICODE)', f'add_definitions(-DUNICODE -D_UNICODE)\nadd_compile_definitions({SILENCE})', 1))

print('Plataformas ajustadas para COROC.')
