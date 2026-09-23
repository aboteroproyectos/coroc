import 'package:uuid/uuid.dart';

import '../models/models.dart';
import 'api_client.dart';

typedef Json = Map<String, dynamic>;

List<T> _list<T>(Object? raw, T Function(Json) f) => (raw as List<dynamic>).cast<Json>().map(f).toList();

/// Operaciones de la API usadas por la app en la Fase 1. Cada método corresponde a una operación del contrato OpenAPI.
class CorocApi {
  CorocApi(this.client);
  final ApiClient client;

  // ─── Ingreso y perfil (§7) ───
  Future<Json> login({required String tenant, required String username, required String password, required String deviceId, String? deviceName}) async =>
      await client.post('/auth/login', auth: false, body: {'tenant': tenant, 'username': username, 'password': password, 'deviceId': deviceId, 'deviceName': ?deviceName}) as Json;

  Future<Session> verifyMfa(String challengeId, String code) async =>
      Session.fromJson(await client.post('/auth/mfa', auth: false, body: {'challengeId': challengeId, 'code': code}) as Json);

  Future<Session> refresh(String refreshToken, String deviceId) async =>
      Session.fromJson(await client.post('/auth/refresh', auth: false, body: {'refreshToken': refreshToken, 'deviceId': deviceId}) as Json);

  Future<void> logout() async => client.post('/auth/logout');
  Future<void> forgotPassword(String tenant, String username) async => client.post('/auth/password/forgot', auth: false, body: {'tenant': tenant, 'username': username});

  Future<User> me() async => User.fromJson(await client.get('/me') as Json);
  Future<User> updateMe({String? lang, String? theme, String? name, int? autoLockMinutes}) async => User.fromJson(
        await client.patch('/me', body: {'lang': ?lang, 'theme': ?theme, 'name': ?name, 'autoLockMinutes': ?autoLockMinutes}) as Json,
      );
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
  Future<User> createUser({required String username, required String name, required String role, required String password, String? email}) async => User.fromJson(
        await client.post('/users', body: {'username': username, 'name': name, 'role': role, 'password': password, 'email': ?email}) as Json,
      );
  Future<User> updateUser(String id, {bool? active, String? role, String? name}) async =>
      User.fromJson(await client.patch('/users/$id', body: {'active': ?active, 'role': ?role, 'name': ?name}) as Json);
  Future<void> revokeUserSessions(String id) async => client.delete('/users/$id/sessions');
  Future<List<RateCap>> rateCaps() async => _list(await client.get('/compliance/rate-caps'), RateCap.fromJson);
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
  Future<Loan> addLoan(String clientId, Json loanInput) async =>
      Loan.fromJson(await client.post('/clients/$clientId/loans', headers: {'Idempotency-Key': const Uuid().v4()}, body: loanInput) as Json);

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
      PaymentResult.fromJson(await client.post(
        '/loans/$loanId/payments',
        headers: {'Idempotency-Key': idempotencyKey},
        body: {'amount': amount, 'date': date, 'method': ?method, 'reference': ?reference, 'note': ?note, 'cash': cash},
      ) as Json);

  Future<void> reversePayment(String loanId, String entryId, String reason) async => client.post('/loans/$loanId/payments/$entryId/reversal', body: {'reason': reason});

  // ─── Dashboard (§17) ───
  Future<Dashboard> dashboard({String? currency, int days = 30}) async => Dashboard.fromJson(await client.get('/dashboard', query: {'currency': currency, 'days': days}) as Json);
  Future<TodayCollections> today() async => TodayCollections.fromJson(await client.get('/collections/today') as Json);
  Stream<ServerEvent> events() => client.events();
}
