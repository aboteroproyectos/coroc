import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';

void main() {
  testWidgets('la sesión recordada se restaura y abre el tablero; cada sección carga sin errores', (tester) async {
    final app = await bootApp(tester);
    expect(app.api.sent('POST', '/auth/refresh'), hasLength(1));
    for (final route in [
      '/dashboard',
      '/today',
      '/clients',
      '/clients/${app.api.id('client')}',
      '/inbox',
      '/messages',
      '/messages/templates',
      '/reports',
      '/settings',
      '/help',
      '/clients/new',
      '/clients/${app.api.id('client')}/loans/new',
    ]) {
      await app.go(route);
      expect(tester.takeException(), isNull, reason: route);
    }
    await app.finish();
  });
}
