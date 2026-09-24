// Fase 5 · La app y el servidor hablan el mismo contrato: cada operación de CorocApi se llama contra un servidor de
// prueba y la petición (método y ruta) tiene que existir en services/api/openapi.yaml.
import 'dart:io';

import 'package:coroc/core/api/api_client.dart';
import 'package:coroc/core/api/coroc_api.dart';
import 'package:coroc/core/models/models.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:yaml/yaml.dart';

import 'support.dart';

const _id = '7a2c0000-0000-4000-8000-000000000001';
const _id2 = '7a2c0000-0000-4000-8000-000000000002';

void main() {
  test('cada operación de la app corresponde a una operación del contrato OpenAPI', () async {
    final doc = loadYaml(File('../../services/api/openapi.yaml').readAsStringSync()) as YamlMap;
    final ops = <({String method, RegExp path, String id})>[];
    (doc['paths'] as YamlMap).forEach((route, item) {
      for (final m in ['get', 'post', 'put', 'patch', 'delete']) {
        final op = (item as YamlMap)[m] as YamlMap?;
        if (op == null) continue;
        final re = RegExp('^/v1${(route as String).replaceAllMapped(RegExp(r'\{\w+\}'), (_) => '[^/]+')}\$');
        ops.add((method: m.toUpperCase(), path: re, id: op['operationId'] as String));
      }
    });

    final seen = <String>[];
    final unknown = <String>[];
    final api = CorocApi(ApiClient(
      baseUrl: 'https://api.test/v1',
      store: MemorySessionStore(),
      language: () => 'es',
      client: MockClient((req) async {
        final match = ops.where((o) => o.method == req.method && o.path.hasMatch(req.url.path)).toList();
        if (match.isEmpty) {
          unknown.add('${req.method} ${req.url.path}');
        } else {
          seen.add(match.first.id);
        }
        return http.Response('{}', 200, headers: {'content-type': 'application/json'});
      }),
    ));
    Stream<List<int>> open() => Stream.value(const [1, 2, 3]);
    final calls = <Future<Object?> Function()>[
      () => api.login(tenant: 't', username: 'u', password: 'p', deviceId: 'd'),
      () => api.verifyMfa('c', '123456'),
      () => api.refresh('r', 'd'),
      api.logout,
      () => api.forgotPassword('t', 'u'),
      api.me,
      () => api.updateMe(lang: 'es'),
      () => api.changePassword('a', 'b'),
      api.enrollMfa,
      () => api.confirmMfa('123456'),
      () => api.disableMfa('123456'),
      api.mySessions,
      () => api.revokeMySession(_id),
      api.company,
      () => api.updateCompany({'name': 'x'}, 1),
      api.users,
      () => api.createUser(username: 'u', name: 'n', role: 'collector', password: 'p'),
      () => api.updateUser(_id, active: false),
      () => api.revokeUserSessions(_id),
      api.rateCaps,
      () => api.addRateCap(country: 'CO', effectiveAnnual: 0.25, validFrom: '2026-10-01', validTo: '2026-12-31', source: 's'),
      () => api.clients(q: 'ana'),
      () => api.clientById(_id),
      () => api.createClient({}, {}),
      () => api.updateClient(_id, {}, 1),
      () => api.addLoan(_id, {}),
      () => api.previewLoan({}),
      () => api.loan(_id),
      () => api.schedule(_id),
      () => api.ledger(_id),
      () => api.receipts(_id),
      () => api.previewPayment(_id, 1, '2026-10-09'),
      () => api.pay(_id, amount: 1, date: '2026-10-09', idempotencyKey: 'k'),
      () => api.replayPayment(_id, amount: 1, date: '2026-10-09', idempotencyKey: 'k'),
      () => api.reversePayment(_id, _id2, 'motivo'),
      api.dashboard,
      api.today,
      api.documents,
      () => api.document(_id),
      () => api.setDocumentTags(_id, ['a']),
      () => api.documentLink(_id),
      () => api.uploadDocument(_id, open: open, length: 3),
      () => api.requestStatement(_id),
      () => api.task(_id),
      api.folderManifest,
      () => api.requestReport(type: 'portfolio', format: 'pdf'),
      api.backups,
      () => api.backup(_id),
      () => api.createBackup('p'),
      () => api.cancelBackup(_id),
      () => api.backupLink(_id),
      () => api.uploadRestore(open: open, length: 3),
      () => api.verifyRestore(_id, 'p'),
      () => api.applyRestore(_id, 'p', 'n'),
      api.intake,
      api.intakeSummary,
      () => api.intakeItem(_id),
      () => api.uploadIntake(open: open, length: 3),
      () => api.approveIntake(_id, clientId: _id, loanId: _id2, amount: 1, date: '2026-10-09', idempotencyKey: 'k'),
      () => api.approveIntakeBatch([_id]),
      () => api.rejectIntake(_id, 'r'),
      () => api.archiveIntake(_id),
      () => api.revertIntake(_id),
      () => api.uploadLink(_id),
      () => api.rotateUploadLink(_id),
      () => api.revokeUploadLink(_id),
      api.receivingAccounts,
      () => api.addReceivingAccount(holderName: 'h'),
      () => api.removeReceivingAccount(_id),
      api.whatsAppAccount,
      () => api.saveWhatsAppAccount(phoneNumberId: '1', accessToken: 't'),
      api.removeWhatsAppAccount,
      () => api.setWhatsAppMode('assisted'),
      api.messages,
      api.messagesSummary,
      () => api.composeMessage(loanId: _id, event: 'manual', channel: 'email'),
      () => api.sendMessage(_id),
      () => api.cancelMessage(_id),
      () => api.retryMessage(_id),
      api.templates,
      () => api.saveTemplate('reminder', 'es', body: 'b'),
      () => api.previewTemplate(event: 'reminder'),
      api.contactRules,
      () => api.saveContactRules(dailyReminders: true),
      () => api.setContactException(_id, const [ContactWindow(day: 1, start: '07:00', end: '19:00')], _id2),
      () => api.removeContactException(_id),
      api.emailSender,
      () => api.saveEmailSender(fromEmail: 'a@b.co'),
      api.verifyEmailSender,
      api.deleteEmailSender,
      api.failures,
      () => api.retryTask(_id),
      () => api.traceIntake(_id),
      () => api.deleteMyAccount('p'),
      () => api.deleteUser(_id),
      () => api.closeCompany('p', 'slug'),
    ];
    for (final (i, c) in calls.indexed) {
      try {
        await c().timeout(const Duration(seconds: 2), onTimeout: () => fail('la llamada $i no terminó'));
      } on TestFailure {
        rethrow;
      } on Object {
        // Las respuestas vacías no se pueden leer como modelos: aquí solo importa la petición.
      }
    }
    expect(unknown, isEmpty, reason: 'peticiones de la app que no están en el contrato');
    expect(seen.toSet().length, greaterThanOrEqualTo(90));
  });
}
