import 'package:uuid/uuid.dart';

import '../models/models.dart';
import '../models/support.dart' show Failures, IntakeTrace;
import 'api_client.dart';
import 'api_exception.dart';

typedef Json = Map<String, dynamic>;

List<T> _list<T>(Object? raw, T Function(Json) f) => (raw as List<dynamic>).cast<Json>().map(f).toList();

/// Operaciones de la API usadas por la app (fases 1 a 3). Cada método corresponde a una operación del contrato OpenAPI.
class CorocApi {
  CorocApi(this.client);
  final ApiClient client;

  // ─── Ingreso y perfil (§7) ───
  Future<Json> login({required String tenant, required String username, required String password, required String deviceId, String? deviceName}) async =>
      await client.post('/auth/login', auth: false, body: {'tenant': tenant, 'username': username, 'password': password, 'deviceId': deviceId, 'deviceName': ?deviceName}) as Json;

  Future<Session> verifyMfa(String challengeId, String code) async => Session.fromJson(await client.post('/auth/mfa', auth: false, body: {'challengeId': challengeId, 'code': code}) as Json);

  Future<Session> refresh(String refreshToken, String deviceId) async =>
      Session.fromJson(await client.post('/auth/refresh', auth: false, body: {'refreshToken': refreshToken, 'deviceId': deviceId}) as Json);

  Future<void> logout() async => client.post('/auth/logout');
  Future<void> forgotPassword(String tenant, String username) async => client.post('/auth/password/forgot', auth: false, body: {'tenant': tenant, 'username': username});

  Future<User> me() async => User.fromJson(await client.get('/me') as Json);
  Future<User> updateMe({String? lang, String? theme, String? name, int? autoLockMinutes}) async =>
      User.fromJson(await client.patch('/me', body: {'lang': ?lang, 'theme': ?theme, 'name': ?name, 'autoLockMinutes': ?autoLockMinutes}) as Json);
  Future<void> changePassword(String current, String next) async => client.post('/me/password', body: {'currentPassword': current, 'newPassword': next});
  Future<MfaEnrollment> enrollMfa() async => MfaEnrollment.fromJson(await client.post('/me/mfa/enroll') as Json);
  Future<Session> confirmMfa(String code) async => Session.fromJson(await client.post('/me/mfa/confirm', body: {'code': code}) as Json);
  Future<void> disableMfa(String code) async => client.delete('/me/mfa', body: {'code': code});
  Future<List<SessionInfo>> mySessions() async => _list(await client.get('/me/sessions'), SessionInfo.fromJson);
  Future<void> revokeMySession(String id) async => client.delete('/me/sessions/$id');

  // ─── Empresa, usuarios y cumplimiento ───
  Future<Company> company() async => Company.fromJson(await client.get('/company') as Json);
  Future<Company> updateCompany(Json patch, int version) async => Company.fromJson(await client.patch('/company', body: patch, headers: {'If-Match': '$version'}) as Json);
  Future<List<User>> users() async => _list(await client.get('/users'), User.fromJson);
  Future<User> createUser({required String username, required String name, required String role, required String password, String? email}) async =>
      User.fromJson(await client.post('/users', body: {'username': username, 'name': name, 'role': role, 'password': password, 'email': ?email}) as Json);
  Future<User> updateUser(String id, {bool? active, String? role, String? name}) async =>
      User.fromJson(await client.patch('/users/$id', body: {'active': ?active, 'role': ?role, 'name': ?name}) as Json);
  Future<void> revokeUserSessions(String id) async => client.delete('/users/$id/sessions');
  Future<List<RateCap>> rateCaps() async => _list(await client.get('/compliance/rate-caps'), RateCap.fromJson);

  /// Préstamos por encima del tope: 'block' o 'warn' (solo el Propietario, aceptando la responsabilidad; ADR-061).
  Future<void> setRateCapPolicy(String policy, {bool acceptResponsibility = false}) async =>
      client.put('/compliance/rate-cap-policy', body: {'policy': policy, if (policy == 'warn') 'acceptResponsibility': acceptResponsibility});
  Future<RateCap> addRateCap({required String country, required double effectiveAnnual, required String validFrom, required String validTo, required String source}) async => RateCap.fromJson(
    await client.post('/compliance/rate-caps', body: {'country': country, 'effectiveAnnual': effectiveAnnual, 'validFrom': validFrom, 'validTo': validTo, 'source': source}) as Json,
  );

  // ─── Clientes y préstamos (§8–§10) ───
  Future<ClientPage> clients({String? q, String? status, String? frequency, String? cursor, int limit = 50}) async =>
      ClientPage.fromJson(await client.get('/clients', query: {'q': q, 'status': status, 'frequency': frequency, 'cursor': cursor, 'limit': limit}) as Json);

  Future<Client> clientById(String id) async => Client.fromJson(await client.get('/clients/$id') as Json);

  Future<({Client client, Loan loan})> createClient(Json clientInput, Json loanInput, {bool acknowledgeDuplicate = false}) async {
    final res = await client.post('/clients', headers: {'Idempotency-Key': const Uuid().v4()}, body: {'client': clientInput, 'loan': loanInput, 'acknowledgeDuplicate': acknowledgeDuplicate}) as Json;
    return (client: Client.fromJson(res['client'] as Json), loan: Loan.fromJson(res['loan'] as Json));
  }

  Future<Client> updateClient(String id, Json input, int version) async => Client.fromJson(await client.patch('/clients/$id', body: input, headers: {'If-Match': '$version'}) as Json);
  Future<Loan> addLoan(String clientId, Json loanInput) async => Loan.fromJson(await client.post('/clients/$clientId/loans', headers: {'Idempotency-Key': const Uuid().v4()}, body: loanInput) as Json);

  Future<LoanPreview> previewLoan(Json terms) async => LoanPreview.fromJson(await client.post('/loans/preview', body: terms) as Json);
  Future<Loan> loan(String id) async => Loan.fromJson(await client.get('/loans/$id') as Json);
  Future<List<InstallmentState>> schedule(String loanId) async => _list(await client.get('/loans/$loanId/schedule'), InstallmentState.fromJson);
  Future<List<LedgerEntry>> ledger(String loanId) async => _list(await client.get('/loans/$loanId/ledger'), LedgerEntry.fromJson);
  Future<List<ReceiptRecord>> receipts(String loanId) async => _list(await client.get('/loans/$loanId/receipts'), ReceiptRecord.fromJson);

  // ─── Pagos (§14) ───
  Future<PaymentPreview> previewPayment(String loanId, int amount, String date) async =>
      PaymentPreview.fromJson(await client.post('/loans/$loanId/payments/preview', body: {'amount': amount, 'date': date}) as Json);

  /// La clave de idempotencia la genera la pantalla una vez por pago: si la red falla y se reintenta, no se duplica.
  Future<PaymentResult> pay(String loanId, {required int amount, required String date, required String idempotencyKey, String? method, String? reference, bool cash = false, String? note}) async =>
      PaymentResult.fromJson(
        await client.post(
              '/loans/$loanId/payments',
              headers: {'Idempotency-Key': idempotencyKey},
              body: {'amount': amount, 'date': date, 'method': ?method, 'reference': ?reference, 'note': ?note, 'cash': cash},
            )
            as Json,
      );

  /// Reenvío de un pago de la cola sin conexión: el resultado no hace falta, solo que el servidor lo acepte.
  Future<void> replayPayment(String loanId, {required int amount, required String date, required String idempotencyKey, String? method, String? reference, bool cash = false, String? note}) async =>
      client.post(
        '/loans/$loanId/payments',
        headers: {'Idempotency-Key': idempotencyKey},
        body: {'amount': amount, 'date': date, 'method': ?method, 'reference': ?reference, 'note': ?note, 'cash': cash},
      );

  Future<void> reversePayment(String loanId, String entryId, String reason) async => client.post('/loans/$loanId/payments/$entryId/reversal', body: {'reason': reason});

  // ─── Dashboard (§17) ───
  Future<Dashboard> dashboard({String? currency, int days = 30}) async => Dashboard.fromJson(await client.get('/dashboard', query: {'currency': currency, 'days': days}) as Json);
  Future<TodayCollections> today() async => TodayCollections.fromJson(await client.get('/collections/today') as Json);
  Stream<ServerEvent> events() => client.events();

  // ─── Documentos y carpeta COROC (§15, §16) ───
  Future<DocumentPage> documents({String? clientId, String? loanId, String? kind, String? q, String? tag, bool includeSuperseded = false, String? cursor, int limit = 100}) async =>
      DocumentPage.fromJson(
        await client.get(
              '/documents',
              query: {'clientId': clientId, 'loanId': loanId, 'kind': kind, 'q': q, 'tag': tag, 'includeSuperseded': includeSuperseded ? true : null, 'cursor': cursor, 'limit': limit},
            )
            as Json,
      );
  Future<CorocDocument> document(String id) async => CorocDocument.fromJson(await client.get('/documents/$id') as Json);
  Future<CorocDocument> setDocumentTags(String id, List<String> tags) async => CorocDocument.fromJson(await client.patch('/documents/$id', body: {'tags': tags}) as Json);
  Future<FileLink> documentLink(String id) async => FileLink.fromJson(await client.post('/documents/$id/link') as Json);
  Future<CorocDocument> uploadDocument(
    String clientId, {
    required Stream<List<int>> Function() open,
    required int length,
    String? loanId,
    String kind = 'other',
    String? name,
    List<String> tags = const [],
  }) async => CorocDocument.fromJson(
    await client.upload('/clients/$clientId/documents', open: open, length: length, query: {'loanId': loanId, 'kind': kind, 'name': name, 'tags': tags.isEmpty ? null : tags.join(',')}) as Json,
  );
  Future<TaskInfo> requestStatement(String loanId) async => TaskInfo.fromJson(await client.post('/loans/$loanId/statements') as Json);
  Future<TaskInfo> task(String id) async => TaskInfo.fromJson(await client.get('/tasks/$id') as Json);
  Future<FolderManifest> folderManifest({String? since, String? after}) async => FolderManifest.fromJson(await client.get('/folder/manifest', query: {'since': since, 'after': after}) as Json);

  // ─── Informes (§18) ───
  Future<TaskInfo> requestReport({required String type, required String format, String? lang, String? from, String? to, String? collectorId, String? currency}) async =>
      TaskInfo.fromJson(await client.post('/reports', body: {'type': type, 'format': format, 'lang': ?lang, 'from': ?from, 'to': ?to, 'collectorId': ?collectorId, 'currency': ?currency}) as Json);

  // ─── Respaldo y restauración (§19) ───
  Future<List<BackupInfo>> backups() async => _list(await client.get('/backups'), BackupInfo.fromJson);
  Future<BackupInfo> backup(String id) async => BackupInfo.fromJson(await client.get('/backups/$id') as Json);
  Future<BackupInfo> createBackup(String password) async => BackupInfo.fromJson(await client.post('/backups', body: {'password': password}) as Json);
  Future<BackupInfo> cancelBackup(String id) async => BackupInfo.fromJson(await client.post('/backups/$id/cancel') as Json);
  Future<FileLink> backupLink(String id) async => FileLink.fromJson(await client.post('/backups/$id/link') as Json);
  Future<RestoreInfo> uploadRestore({required Stream<List<int>> Function() open, required int length, void Function(int, int)? onProgress}) async =>
      RestoreInfo.fromJson(await client.upload('/restores', open: open, length: length, onProgress: onProgress) as Json);
  Future<RestoreInfo> verifyRestore(String id, String password) async => RestoreInfo.fromJson(await client.post('/restores/$id/verify', body: {'password': password}) as Json);
  Future<RestoreInfo> applyRestore(String id, String password, String confirmName) async =>
      RestoreInfo.fromJson(await client.post('/restores/$id/apply', body: {'password': password, 'confirmName': confirmName}) as Json);

  // ─── Recepción y Bandeja de validación (§12, §13) ───
  Future<IntakePage> intake({List<String> status = const [], String? channel, String? clientId, String? cursor, int limit = 50}) async =>
      IntakePage.fromJson(await client.get('/intake', query: {'status': status.isEmpty ? null : status.join(','), 'channel': channel, 'clientId': clientId, 'cursor': cursor, 'limit': limit}) as Json);
  Future<IntakeSummary> intakeSummary() async => IntakeSummary.fromJson(await client.get('/intake/summary') as Json);
  Future<IntakeItem> intakeItem(String id) async => IntakeItem.fromJson(await client.get('/intake/$id') as Json);

  /// Comprobante desde la app: «Compartir con COROC» (`share`), carpeta vigilada (`folder`) o subida manual (`upload`).
  Future<IntakeItem> uploadIntake({
    required Stream<List<int>> Function() open,
    required int length,
    String channel = 'upload',
    String? clientId,
    String? loanId,
    String? fileName,
    String? note,
  }) async =>
      IntakeItem.fromJson(await client.upload('/intake', open: open, length: length, query: {'channel': channel, 'clientId': clientId, 'loanId': loanId, 'fileName': fileName, 'note': note}) as Json);

  /// Aprobar (corrigiendo o reasignando si hace falta). La clave de idempotencia la genera la pantalla una vez.
  Future<PaymentResult> approveIntake(
    String id, {
    required String clientId,
    required String loanId,
    required int amount,
    required String date,
    required String idempotencyKey,
    String? payerName,
    String? receiverName,
    String? reference,
    String? institution,
    bool saveSenderAsSecondaryNumber = false,
  }) async => PaymentResult.fromJson(
    await client.post(
          '/intake/$id/approve',
          headers: {'Idempotency-Key': idempotencyKey},
          body: {
            'clientId': clientId,
            'loanId': loanId,
            'amount': amount,
            'date': date,
            'payerName': ?payerName,
            'receiverName': ?receiverName,
            'reference': ?reference,
            'institution': ?institution,
            'saveSenderAsSecondaryNumber': saveSenderAsSecondaryNumber,
          },
        )
        as Json,
  );
  Future<({List<String> approved, List<({String id, String reason})> skipped})> approveIntakeBatch(List<String> ids) async {
    final r = await client.post('/intake/approve-batch', body: {'ids': ids}) as Json;
    return (approved: (r['approved'] as List<dynamic>).cast<String>(), skipped: [for (final s in (r['skipped'] as List<dynamic>).cast<Json>()) (id: s['id'] as String, reason: s['reason'] as String)]);
  }

  Future<IntakeItem> rejectIntake(String id, String reason) async => IntakeItem.fromJson(await client.post('/intake/$id/reject', body: {'reason': reason}) as Json);
  Future<IntakeItem> archiveIntake(String id) async => IntakeItem.fromJson(await client.post('/intake/$id/archive') as Json);
  Future<IntakeItem> revertIntake(String id, {String? reason}) async => IntakeItem.fromJson(await client.post('/intake/$id/revert', body: {'reason': ?reason}) as Json);

  // ─── Enlace personal de carga (§12.3) ───
  Future<UploadLink?> uploadLink(String loanId) async {
    try {
      return UploadLink.fromJson(await client.get('/loans/$loanId/upload-link') as Json);
    } on ApiException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }

  Future<UploadLink> rotateUploadLink(String loanId) async => UploadLink.fromJson(await client.post('/loans/$loanId/upload-link') as Json);
  Future<void> revokeUploadLink(String loanId) async => client.delete('/loans/$loanId/upload-link');

  // ─── Cuentas receptoras y WhatsApp (§12.1, §13.4) ───
  Future<List<ReceivingAccount>> receivingAccounts() async => _list(await client.get('/receiving-accounts'), ReceivingAccount.fromJson);
  Future<ReceivingAccount> addReceivingAccount({required String holderName, String? institution, String? last4}) async =>
      ReceivingAccount.fromJson(await client.post('/receiving-accounts', body: {'holderName': holderName, 'institution': ?institution, 'last4': ?last4}) as Json);
  Future<void> removeReceivingAccount(String id) async => client.delete('/receiving-accounts/$id');
  Future<WhatsAppAccount> whatsAppAccount() async => WhatsAppAccount.fromJson(await client.get('/company/whatsapp') as Json);
  Future<WhatsAppAccount> saveWhatsAppAccount({required String phoneNumberId, required String accessToken, String? displayNumber, String? wabaId}) async =>
      WhatsAppAccount.fromJson(await client.put('/company/whatsapp', body: {'phoneNumberId': phoneNumberId, 'accessToken': accessToken, 'displayNumber': ?displayNumber, 'wabaId': ?wabaId}) as Json);
  Future<void> removeWhatsAppAccount() async => client.delete('/company/whatsapp');

  /// Modo de envío de WhatsApp (§11.1): `assisted` o `cloud_api` con la lista de verificación completa.
  Future<WhatsAppAccount> setWhatsAppMode(String mode, {WhatsAppChecklist? checklist}) async => WhatsAppAccount.fromJson(
    await client.put(
          '/company/whatsapp/mode',
          body: {
            'mode': mode,
            if (checklist != null)
              'checklist': {
                'businessVerified': checklist.businessVerified,
                'dedicatedNumber': checklist.dedicatedNumber,
                'templatesApproved': checklist.templatesApproved,
                'legalReview': checklist.legalReview,
                'policyAccepted': checklist.policyAccepted,
              },
          },
        )
        as Json,
  );

  // ─── Mensajería (§11) ───
  Future<MessagePage> messages({List<String> status = const [], String? clientId, String? channel, String? event, String? cursor, int limit = 50}) async => MessagePage.fromJson(
    await client.get('/messages', query: {'status': status.isEmpty ? null : status.join(','), 'clientId': clientId, 'channel': channel, 'event': event, 'cursor': cursor, 'limit': limit}) as Json,
  );
  Future<MessagesSummary> messagesSummary() async => MessagesSummary.fromJson(await client.get('/messages/summary') as Json);
  Future<CorocMessage> composeMessage({required String loanId, required String event, required String channel, String? body}) async =>
      CorocMessage.fromJson(await client.post('/messages', body: {'loanId': loanId, 'event': event, 'channel': channel, 'body': ?body}) as Json);
  Future<CorocMessage> sendMessage(String id) async => CorocMessage.fromJson(await client.post('/messages/$id/send') as Json);
  Future<CorocMessage> cancelMessage(String id) async => CorocMessage.fromJson(await client.post('/messages/$id/cancel') as Json);
  Future<CorocMessage> retryMessage(String id) async => CorocMessage.fromJson(await client.post('/messages/$id/retry') as Json);

  // ─── Plantillas (§11.3) ───
  Future<TemplatesView> templates() async => TemplatesView.fromJson(await client.get('/message-templates') as Json);
  Future<MessageTemplate> saveTemplate(String event, String lang, {required String body, String? subject, bool active = true, String? metaTemplateName, String? metaTemplateLang}) async =>
      MessageTemplate.fromJson(
        await client.put('/message-templates/$event/$lang', body: {'body': body, 'subject': ?subject, 'active': active, 'metaTemplateName': metaTemplateName, 'metaTemplateLang': metaTemplateLang})
            as Json,
      );
  Future<TemplatePreview> previewTemplate({required String event, String? lang, String? loanId, String? body, String? subject}) async =>
      TemplatePreview.fromJson(await client.post('/message-templates/preview', body: {'event': event, 'lang': ?lang, 'loanId': ?loanId, 'body': ?body, 'subject': ?subject}) as Json);

  // ─── Reglas de contacto (§11.4) ───
  Future<ContactRules> contactRules() async => ContactRules.fromJson(await client.get('/compliance/contact-rules') as Json);
  Future<ContactRules> saveContactRules({String? preset, bool? counselReviewed, bool? transactionalImmediate, String? reminderTime, bool? dailyReminders}) async => ContactRules.fromJson(
    await client.put(
          '/compliance/contact-rules',
          body: {'preset': ?preset, 'counselReviewed': ?counselReviewed, 'transactionalImmediate': ?transactionalImmediate, 'reminderTime': ?reminderTime, 'dailyReminders': ?dailyReminders},
        )
        as Json,
  );
  Future<ContactException> setContactException(String clientId, List<ContactWindow> windows, String documentId) async => ContactException.fromJson(
    await client.put(
          '/clients/$clientId/contact-exception',
          body: {
            'windows': [
              for (final w in windows) {'day': w.day, 'start': w.start, 'end': w.end},
            ],
            'documentId': documentId,
          },
        )
        as Json,
  );
  Future<void> removeContactException(String clientId) async => client.delete('/clients/$clientId/contact-exception');

  // ─── Correo saliente (§11.2) ───
  Future<EmailSender> emailSender() async => EmailSender.fromJson(await client.get('/company/email-sender') as Json);
  Future<EmailSender> saveEmailSender({required String fromEmail, String? fromName, String? dkimSelector}) async =>
      EmailSender.fromJson(await client.put('/company/email-sender', body: {'fromEmail': fromEmail, 'fromName': ?fromName, 'dkimSelector': ?dkimSelector}) as Json);
  Future<EmailSender> verifyEmailSender() async => EmailSender.fromJson(await client.post('/company/email-sender/verify') as Json);
  Future<void> deleteEmailSender() async => client.delete('/company/email-sender');

  // ─── Soporte (Fase 5) ───
  Future<Failures> failures({int days = 30}) async => Failures.fromJson(await client.get('/support/failures', query: {'days': days}) as Json);
  Future<void> retryTask(String id) async => client.post('/tasks/$id/retry');
  Future<IntakeTrace> traceIntake(String id) async => IntakeTrace.fromJson(await client.get('/intake/$id/trace') as Json);

  // ─── Eliminación de cuentas (App Store 5.1.1(v), Google Play) ───
  Future<void> deleteMyAccount(String password) async => client.delete('/me', body: {'password': password});
  Future<void> deleteUser(String id) async => client.delete('/users/$id');
  Future<void> closeCompany(String password, String confirmSlug) async => client.post('/company/closure', body: {'password': password, 'confirmSlug': confirmSlug});
}
