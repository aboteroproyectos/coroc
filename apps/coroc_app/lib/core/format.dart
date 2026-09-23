import 'package:intl/intl.dart';

/// Formato de dinero en unidades mínimas (ADR-001, ADR-018): cada moneda con su formato nativo en pantalla
/// (COP «$ 1.200.000», BRL «R$ 1.200,00», USD «$1,200.00»), sin importar el idioma de la interfaz.
abstract final class Money {
  static const _digits = {'COP': 0, 'BRL': 2, 'USD': 2};
  static const _locale = {'COP': 'es', 'BRL': 'pt_BR', 'USD': 'en_US'};
  // intl no trae datos de es_CO: se fija el formato colombiano «$ 1.200.000» (símbolo delante, punto de miles, sin decimales).
  static const _pattern = {'COP': '\u00A4\u00A0#,##0'};
  static const _symbol = {'COP': r'$', 'BRL': r'R$', 'USD': r'$'};

  static int digits(String currency) => _digits[currency] ?? 2;

  static String format(int minor, String currency) {
    final d = digits(currency);
    final f = NumberFormat.currency(locale: _locale[currency] ?? 'en_US', symbol: _symbol[currency] ?? currency, decimalDigits: d, customPattern: _pattern[currency]);
    return f.format(minor / _pow(d));
  }

  /// Cifra compacta para ejes y tarjetas estrechas: «$ 1,2 M».
  static String compact(int minor, String currency) {
    final value = minor / _pow(digits(currency));
    if (currency == 'COP') return '\$\u00A0${NumberFormat.compact(locale: 'es').format(value)}';
    final f = NumberFormat.compactCurrency(locale: _locale[currency] ?? 'en_US', symbol: _symbol[currency] ?? currency, decimalDigits: value.abs() >= 1000 ? 1 : 0);
    return f.format(value);
  }

  /// Convierte lo que el usuario escribe («1.200.000», «1200000», «1.200,50») a unidades mínimas.
  static int? parse(String input, String currency) {
    final d = digits(currency);
    var s = input.replaceAll(RegExp(r'[^0-9,.\-]'), '');
    if (s.isEmpty) return null;
    if (d == 0) {
      s = s.replaceAll(RegExp(r'[.,]'), '');
      return int.tryParse(s);
    }
    final lastSep = s.lastIndexOf(RegExp(r'[.,]'));
    String intPart = s;
    String frac = '';
    if (lastSep >= 0 && s.length - lastSep - 1 <= d) {
      intPart = s.substring(0, lastSep);
      frac = s.substring(lastSep + 1);
    }
    intPart = intPart.replaceAll(RegExp(r'[.,]'), '');
    final whole = int.tryParse(intPart.isEmpty ? '0' : intPart);
    if (whole == null) return null;
    final f = int.tryParse(frac.padRight(d, '0').substring(0, d)) ?? 0;
    return whole * _pow(d) + f;
  }

  static int _pow(int d) => d == 0 ? 1 : (d == 1 ? 10 : 100);
}

abstract final class Dates {
  static String _loc(String lang) => lang == 'pt' ? 'pt_BR' : (lang == 'en' ? 'en_US' : 'es');

  /// «9 oct 2026» / «9 de out. de 2026» / «Oct 9, 2026».
  static String medium(String iso, String lang) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat.yMMMd(_loc(lang)).format(d);
  }

  static String long(String iso, String lang) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat.yMMMMEEEEd(_loc(lang)).format(d);
  }

  static String dayMonth(String iso, String lang) {
    final d = DateTime.tryParse(iso);
    return d == null ? iso : DateFormat.MMMd(_loc(lang)).format(d);
  }

  static String dateTime(String iso, String lang) {
    final d = DateTime.tryParse(iso)?.toLocal();
    return d == null ? iso : '${DateFormat.yMMMd(_loc(lang)).format(d)} · ${DateFormat.Hm(_loc(lang)).format(d)}';
  }

  static String isoToday() => iso(DateTime.now());

  /// Fecha civil «AAAA-MM-DD» (sin hora ni zona).
  static String iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// Tasa como porcentaje en el idioma: 0.2493 → «24,93 %».
String percent(double x, String lang) => NumberFormat.decimalPercentPattern(locale: lang == 'pt' ? 'pt_BR' : (lang == 'en' ? 'en_US' : 'es'), decimalDigits: 2).format(x);
