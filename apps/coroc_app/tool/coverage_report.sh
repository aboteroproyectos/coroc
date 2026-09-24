#!/usr/bin/env bash
# Cobertura de la app sin código generado (modelos, idiomas). Uso: tool/coverage_report.sh [umbral] [--files]
set -e
LCOV="${LCOV:-coverage/lcov.info}"
if [ "$2" = "--files" ] || [ "$1" = "--files" ]; then
  awk -F: '/^SF:/{f=$2} /^LF:/{lf=$2} /^LH:/{if (f !~ /\.g\.dart|freezed|l10n\/gen/) printf "%5d %5d %5.1f%% %s\n", lf-$2, lf, 100*$2/lf, f}' "$LCOV" | sort -rn | head -40
fi
awk -F: -v min="${1:-0}" '/^SF:/{g=($2 ~ /\.g\.dart|\.freezed\.dart|l10n\/gen/)} /^LF:/{if(!g)lf+=$2} /^LH:/{if(!g)lh+=$2} END{p=100*lh/lf; printf "Cobertura de la app: %.1f%% (%d/%d líneas)\n", p, lh, lf; exit (p < min)}' "$LCOV"
