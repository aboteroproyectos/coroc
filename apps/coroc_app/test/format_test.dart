import 'package:coroc/core/format.dart';
import 'package:coroc/features/loans/loan_terms_form.dart';
import 'package:coroc/features/settings/settings_page.dart';
import 'package:flutter_test/flutter_test.dart';

String _plain(String s) => s.replaceAll(' ', ' ').replaceAll(' ', ' ');

void main() {
  group('Money (ADR-001: unidades mínimas, formato nativo de cada moneda)', () {
    test('COP sin decimales con punto de miles', () {
      final s = _plain(Money.format(1200000, 'COP'));
      expect(s, contains('1.200.000'));
      expect(s.startsWith(r'$'), isTrue);
      expect(s, isNot(contains(',')));
    });

    test('BRL con coma decimal', () {
      final s = _plain(Money.format(120050, 'BRL'));
      expect(s, contains('R\$'));
      expect(s, contains('1.200,50'));
    });

    test('USD con punto decimal', () => expect(_plain(Money.format(120050, 'USD')), r'$1,200.50'));

    test('parse acepta lo que escribe el usuario', () {
      expect(Money.parse('1.200.000', 'COP'), 1200000);
      expect(Money.parse('1200000', 'COP'), 1200000);
      expect(Money.parse(r'$ 1.200.000', 'COP'), 1200000);
      expect(Money.parse('1.200,50', 'BRL'), 120050);
      expect(Money.parse('12,5', 'BRL'), 1250);
      expect(Money.parse('1.200', 'BRL'), 120000);
      expect(Money.parse('1,200.50', 'USD'), 120050);
      expect(Money.parse('', 'COP'), isNull);
      expect(Money.parse('abc', 'USD'), isNull);
    });

    test('ida y vuelta sin pérdida', () {
      for (final (v, c) in [(0, 'COP'), (1, 'COP'), (987654321, 'COP'), (1, 'BRL'), (99, 'USD'), (123456789, 'BRL')]) {
        expect(Money.parse(Money.format(v, c), c), v, reason: '$v $c');
      }
    });
  });

  group('Tasas exactas (sin binario flotante)', () {
    test('porcentaje → fracción', () {
      expect(percentToRate('20'), '0.2');
      expect(percentToRate('1,87'), '0.0187');
      expect(percentToRate('1.87'), '0.0187');
      expect(percentToRate('0.5'), '0.005');
      expect(percentToRate('100'), '1');
      expect(percentToRate('2,123456'), '0.02123456');
      expect(percentToRate(''), isNull);
      expect(percentToRate('1,2,3'), isNull);
      expect(percentToRate('-5'), isNull);
    });

    test('fracción → porcentaje en el idioma', () {
      expect(rateToPercentText('0.0187', 'es'), '1,87');
      expect(rateToPercentText('0.0187', 'en'), '1.87');
      expect(rateToPercentText('0.2', 'pt'), '20');
      expect(rateToPercentText('0.02123456', 'en'), '2.1235');
    });

    test('ida y vuelta', () {
      for (final p in ['20', '1,87', '3,5', '0,25', '12']) {
        expect(rateToPercentText(percentToRate(p)!, 'es'), p);
      }
    });
  });

  test('fecha civil ISO', () {
    expect(Dates.iso(DateTime(2026, 3, 7)), '2026-03-07');
    expect(Dates.iso(DateTime(2026, 13, 0)), '2026-12-31');
  });

  test('contraseña temporal: 19 caracteres legibles y distinta cada vez', () {
    final a = generatePassword();
    final b = generatePassword();
    expect(a, matches(RegExp(r'^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$')));
    expect(a.length, 19);
    expect(a, isNot(b));
  });
}
