import 'dart:convert';

import 'package:coroc/core/l10n.dart';
import 'package:coroc/core/models/models.dart';
import 'package:coroc/design/widgets/common.dart';
import 'package:coroc/design/widgets/labels.dart';
import 'package:coroc/features/messaging/messaging_common.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'app_harness.dart';
import 'fake_api.dart';

final l = lookupAppLocalizations(const Locale('es'));

Json copy(Object? o) => jsonDecode(jsonEncode(o)) as Json;

/// Mensajes reales del servidor en cada estado que muestra la pantalla.
List<Json> messageVariants(FakeApi api) {
  final base = copy((api.get('/messages')['items'] as List).first);
  Json m(String id, String status, {String channel = 'whatsapp', List<Json>? reasons, String decision = 'send', Json? extra}) => {
    ...base,
    'id': id,
    'status': status,
    'channel': channel,
    'decision': {...base['decision'] as Json, 'decision': decision, 'reasons': reasons ?? <Json>[]},
    ...?extra,
  };
  return [
    m('aaaaaaaa-0000-4000-8000-000000000001', 'ready', extra: {'event': 'reminder'}),
    m(
      'aaaaaaaa-0000-4000-8000-000000000002',
      'scheduled',
      decision: 'reschedule',
      reasons: [
        {'code': 'OUT_OF_WINDOW'},
        {'code': 'HOLIDAY_SKIPPED', 'detail': '2026-10-12'},
      ],
    ),
    m('aaaaaaaa-0000-4000-8000-000000000003', 'failed', channel: 'email', extra: {'error': 'El proveedor rechazó el correo.', 'subject': 'Recordatorio'}),
    m(
      'aaaaaaaa-0000-4000-8000-000000000004',
      'blocked',
      decision: 'block',
      reasons: [
        {'code': 'NO_CONSENT', 'detail': 'whatsapp'},
      ],
    ),
    m(
      'aaaaaaaa-0000-4000-8000-000000000005',
      'read',
      extra: {'sentAt': '2026-09-20T15:00:00.000Z', 'deliveredAt': '2026-09-20T15:00:05.000Z', 'readAt': '2026-09-20T15:10:00.000Z', 'via': 'cloud_api'},
    ),
  ];
}

void serveMessages(FakeApi api, List<Json> items) {
  api.overrides['GET /messages'] = (req) {
    final wanted = [for (final v in req.url.queryParametersAll['status'] ?? const <String>[]) ...v.split(',')];
    return FakeApi.json(200, {'items': items.where((m) => wanted.isEmpty || wanted.contains(m['status'])).toList(), 'nextCursor': null});
  };
  api.overrides['GET /messages/summary'] = (_) => FakeApi.json(200, {'ready': 1, 'scheduled': 1, 'blocked': 1, 'failed': 1, 'sentToday': 0});
  for (final action in ['send', 'cancel', 'retry']) {
    api.overrides['POST /messages/{id}/$action'] = (req) {
      final m = copy(items.firstWhere((m) => req.url.path.contains(m['id'] as String)));
      m['status'] = action == 'cancel' ? 'cancelled' : 'sent';
      if (action == 'send') m['assisted'] = {'whatsappUrl': 'https://wa.me/573157778899?text=Hola', 'mailtoUrl': null};
      return FakeApi.json(200, m);
    };
  }
}

void main() {
  testWidgets('mensajes: por enviar, programados, bloqueados e historial con sus acciones y el detalle', (tester) async {
    final api = FakeApi();
    final items = messageVariants(api);
    serveMessages(api, items);
    final app = await bootApp(tester, api: api);
    await app.go('/messages');
    expect(find.text(l.messagesAssistedHelp), findsOneWidget);

    // Por enviar: el modo asistido pide al servidor el texto listo y abre WhatsApp.
    await tapOn(tester, find.text(l.msgSendWhatsapp));
    expect(api.sent('POST', '/messages/{id}/send').single.url.path, contains('00000000001'));

    await tapOn(tester, find.textContaining(l.messagesTabScheduled));
    expect(find.textContaining(l.ruleOutOfWindow), findsOneWidget);
    await tapOn(tester, find.text(l.msgSendNow));
    expect(api.sent('POST', '/messages/{id}/send').last.url.path, contains('00000000002'));
    await tapOn(tester, find.text(l.msgDiscard));
    expect(api.sent('POST', '/messages/{id}/cancel'), hasLength(1));

    await tapOn(tester, find.textContaining(l.messagesTabBlocked));
    expect(find.textContaining(l.ruleNoConsent(l.channelWhatsapp)), findsOneWidget);
    await tapOn(tester, find.text(l.actionRetry));
    expect(api.sent('POST', '/messages/{id}/retry'), hasLength(1));

    await tapOn(tester, find.text(l.messagesTabHistory));
    expect(find.text('El proveedor rechazó el correo.'), findsOneWidget);
    await tapOn(tester, find.text(l.msgStatusRead));
    expect(find.descendant(of: find.byType(AlertDialog), matching: find.text(l.msgReadAt)), findsWidgets);
    expect(find.text(l.msgViaCloud), findsOneWidget);
    await tapOn(tester, find.text(l.actionClose));

    await tapOn(tester, find.text(l.templatesTitle));
    expect(find.text(l.templatesEvents), findsOneWidget);
    await app.finish();
  });

  testWidgets('plantillas: mensajes automáticos, edición con vista previa, validador, restaurar y vista previa con un cliente', (tester) async {
    final api = FakeApi();
    final view = copy(api.get('/message-templates'));
    final reminder = (view['templates'] as List).cast<Json>().firstWhere((t) => t['event'] == 'reminder' && t['lang'] == 'es');
    reminder['custom'] = true;
    api.overrides['GET /message-templates'] = (_) => FakeApi.json(200, view);
    api.overrides['PUT /message-templates/reminder/es'] = (req) => FakeApi.json(200, {...reminder, ...jsonDecode(req.body) as Json});
    api.overrides['POST /message-templates/preview'] = (req) {
      final body = (jsonDecode(req.body) as Json)['body'] as String?;
      final p = copy(api.posts['previewTemplate']);
      if (body != null && body.contains('cárcel')) {
        p['issues'] = [
          {'code': 'THREAT', 'match': 'cárcel'},
          {'code': 'UNKNOWN_VARIABLE', 'match': 'apodo'},
        ];
      }
      return FakeApi.json(200, p);
    };
    final app = await bootApp(tester, api: api);
    await app.go('/messages/templates');

    // Mensajes automáticos: se apaga uno y se cambian sus canales.
    await tapOn(tester, find.widgetWithText(SwitchListTile, eventLabel(l, 'overdue')));
    final patch = api.lastBody('PATCH', '/company')!;
    expect(((patch['settings'] as Json)['messageEvents'] as Json)['overdue'], {
      'enabled': false,
      'channels': ['whatsapp'],
    });
    await tapOn(tester, find.widgetWithText(FilterChip, l.channelEmail).at(1));
    expect(((api.lastBody('PATCH', '/company')!['settings'] as Json)['messageEvents'] as Json)['reminder'], {
      'enabled': true,
      'channels': ['whatsapp', 'email'],
    });

    // Editar el recordatorio: el validador bloquea amenazas y variables desconocidas.
    // El título del editor es el último «Recordatorio» de la página (el primero está en los mensajes automáticos).
    final card = find.ancestor(of: find.text(eventLabel(l, 'reminder')).last, matching: find.byType(SectionCard)).first;
    final body = find.descendant(of: card, matching: find.byType(TextField)).first;
    await tester.enterText(body, 'Paga o irás a la cárcel, {{apodo}}');
    await settle(tester, frames: 6);
    expect(find.text(l.issueThreat('cárcel')), findsOneWidget);
    expect(find.text(l.issueUnknownVariable('{{apodo}}')), findsOneWidget);
    final save = find.descendant(of: card, matching: find.widgetWithText(FilledButton, l.actionSave));
    expect(tester.widget<FilledButton>(save).onPressed, isNull);

    await tester.enterText(body, 'Hola ');
    await tapOn(tester, find.descendant(of: card, matching: find.widgetWithText(ActionChip, '{{nombre}}')));
    await settle(tester, frames: 6);
    await tapOn(tester, find.descendant(of: card, matching: find.text(l.templatesMetaTitle)));
    await tester.enterText(find.descendant(of: card, matching: find.widgetWithText(TextField, l.templatesMetaName)), 'recordatorio_cuota');
    await tapOn(tester, save);
    expect(api.lastBody('PUT', '/message-templates/reminder/es'), allOf(containsPair('body', 'Hola {{nombre}}'), containsPair('active', true), containsPair('metaTemplateName', 'recordatorio_cuota')));
    await tapOn(tester, find.descendant(of: card, matching: find.text(l.templatesRestore)));
    expect(api.lastBody('PUT', '/message-templates/reminder/es'), containsPair('active', false));

    // Vista previa con un cliente real y en otro idioma.
    await tapOn(tester, find.text(l.templatesPreviewWith));
    await settle(tester, frames: 6);
    await tapOn(tester, find.text('María José Pérez Gómez').last);
    expect(find.text(l.templatesPreviewFor('María José Pérez Gómez')), findsOneWidget);
    expect(api.lastBody('POST', '/message-templates/preview'), containsPair('loanId', api.id('loan')));
    await tapOn(tester, find.text(languageName(l, 'en')));
    await app.finish();
  });

  test('las reglas y el validador se explican en palabras del usuario', () {
    String r(String code, [String? detail]) => reasonText(l, DecisionReason.fromJson({'code': code, 'detail': ?detail}), 'es');
    expect(r('HOLIDAY_SKIPPED', '2026-10-12'), l.ruleHoliday('12 oct 2026'));
    expect(r('MAX_PER_DAY', '2026-10-12'), contains('2026'));
    expect(r('CHANNEL_WEEK', 'email'), l.ruleChannelWeek(l.channelEmail));
    expect(r('OPTED_OUT', 'whatsapp'), l.ruleOptedOut(l.channelWhatsapp));
    for (final code in ['TRANSACTIONAL_IMMEDIATE', 'DEBTOR_EXCEPTION', 'NO_ADDRESS', 'ADDRESS_INVALID', 'CONTENT_BLOCKED', 'LOAN_CLOSED']) {
      expect(r(code), isNot(code), reason: code);
    }
    expect(r('NUEVA_REGLA'), 'NUEVA_REGLA');
    final blocked = ContactDecision.fromJson({
      'decision': 'block',
      'reasons': [
        {'code': 'NO_ADDRESS'},
      ],
      'ruleSet': 'CO_LEY_2300_2023',
    });
    expect(decisionText(l, blocked, 'es'), l.decisionBlocked(l.ruleNoAddress));
    for (final code in ['EMPTY', 'TOO_LONG', 'UNBALANCED_BRACES', 'ASKS_CAUSE', 'THIRD_PARTY', 'SENSITIVE_DATA']) {
      expect(issueText(l, TemplateIssue.fromJson({'code': code, 'match': 'x'})), isNot(code), reason: code);
    }
    for (final s in ['scheduled', 'ready', 'sent', 'delivered', 'read', 'failed', 'blocked', 'cancelled']) {
      expect(messageStatusLabel(l, s).$1, isNotEmpty);
    }
  });
}
