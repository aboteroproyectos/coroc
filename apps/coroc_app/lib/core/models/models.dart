// Modelos de la API (contrato OpenAPI 0.4.0). Montos en unidades mínimas de la moneda (int), fechas civiles como texto.
import 'package:freezed_annotation/freezed_annotation.dart';

part 'models.freezed.dart';
part 'models.g.dart';

@freezed
abstract class User with _$User {
  const User._();
  const factory User({
    required String id,
    required String username,
    required String name,
    String? email,
    required String role,
    required String lang,
    @Default('system') String theme,
    @Default(true) bool active,
    @Default(false) bool mfaEnabled,
    @Default(5) int autoLockMinutes,
    String? lastLoginAt,
    @Default(<String>[]) List<String> permissions,
  }) = _User;

  factory User.fromJson(Map<String, dynamic> json) => _$UserFromJson(json);

  bool can(String permission) => permissions.contains(permission);
}

@freezed
abstract class CompanyBrief with _$CompanyBrief {
  const factory CompanyBrief({
    required String id,
    required String slug,
    required String name,
    required String currency,
    required String country,
    required String timezone,
    required String lang,
  }) = _CompanyBrief;

  factory CompanyBrief.fromJson(Map<String, dynamic> json) => _$CompanyBriefFromJson(json);
}

@freezed
abstract class Session with _$Session {
  const factory Session({
    required String accessToken,
    required String refreshToken,
    required int expiresIn,
    @Default(false) bool mfaEnrollmentRequired,
    required User user,
    required CompanyBrief company,
  }) = _Session;

  factory Session.fromJson(Map<String, dynamic> json) => _$SessionFromJson(json);
}

@freezed
abstract class MfaEnrollment with _$MfaEnrollment {
  const factory MfaEnrollment({required String secret, required String otpauthUri}) = _MfaEnrollment;
  factory MfaEnrollment.fromJson(Map<String, dynamic> json) => _$MfaEnrollmentFromJson(json);
}

@freezed
abstract class SessionInfo with _$SessionInfo {
  const factory SessionInfo({
    required String id,
    required String deviceId,
    String? deviceName,
    required String createdAt,
    required String lastUsedAt,
    @Default(false) bool current,
  }) = _SessionInfo;

  factory SessionInfo.fromJson(Map<String, dynamic> json) => _$SessionInfoFromJson(json);
}

@freezed
abstract class Company with _$Company {
  const factory Company({
    required String id,
    required String slug,
    required String name,
    String? taxId,
    String? phone,
    String? email,
    String? address,
    String? city,
    required String country,
    required String currency,
    required String timezone,
    required String lang,
    @Default(<String, dynamic>{}) Map<String, dynamic> settings,
    required int version,
  }) = _Company;

  factory Company.fromJson(Map<String, dynamic> json) => _$CompanyFromJson(json);
}

@freezed
abstract class NextInstallment with _$NextInstallment {
  const factory NextInstallment({required int number, required String dueDate, required int outstanding}) = _NextInstallment;
  factory NextInstallment.fromJson(Map<String, dynamic> json) => _$NextInstallmentFromJson(json);
}

@freezed
abstract class ClientListItem with _$ClientListItem {
  const factory ClientListItem({
    required String id,
    required String code,
    required String fullName,
    required String phone,
    @Default(<String>[]) List<String> contracts,
    String? frequency,
    NextInstallment? next,
    required int balance,
    required String currency,
    required String status,
    @Default(0) int daysPastDue,
    String? collectorId,
  }) = _ClientListItem;

  factory ClientListItem.fromJson(Map<String, dynamic> json) => _$ClientListItemFromJson(json);
}

@freezed
abstract class ClientPage with _$ClientPage {
  const factory ClientPage({required List<ClientListItem> items, String? nextCursor}) = _ClientPage;
  factory ClientPage.fromJson(Map<String, dynamic> json) => _$ClientPageFromJson(json);
}

@freezed
abstract class CoDebtor with _$CoDebtor {
  const factory CoDebtor({required String name, String? phone, String? email}) = _CoDebtor;
  factory CoDebtor.fromJson(Map<String, dynamic> json) => _$CoDebtorFromJson(json);
}

@freezed
abstract class Consent with _$Consent {
  const factory Consent({required String channel, required String method, required String grantedAt, String? revokedAt}) = _Consent;
  factory Consent.fromJson(Map<String, dynamic> json) => _$ConsentFromJson(json);
}

@freezed
abstract class LoanTerms with _$LoanTerms {
  const factory LoanTerms({
    required int principal,
    required String currency,
    required String method,
    required String rate,
    required int installments,
    required String frequency,
    required String disbursementDate,
    String? firstDueDate,
    @Default(<int>[1, 2, 3, 4, 5, 6]) List<int> collectionDays,
    @Default(true) bool excludeHolidays,
    int? monthlyDay,
    @Default(1) int roundingUnit,
  }) = _LoanTerms;

  factory LoanTerms.fromJson(Map<String, dynamic> json) => _$LoanTermsFromJson(json);
}

@freezed
abstract class LoanSummary with _$LoanSummary {
  const factory LoanSummary({
    required int totalInstallments,
    required int paidInstallments,
    required int remainingInstallments,
    required int totalPayable,
    required int paidTotal,
    @Default(0) int lateFeesOutstanding,
    required int balance,
    NextInstallment? next,
    @Default(0) int overdueCount,
    @Default(0) int daysPastDue,
    @Default(0) int surplus,
    @Default(0.0) double progress,
  }) = _LoanSummary;

  factory LoanSummary.fromJson(Map<String, dynamic> json) => _$LoanSummaryFromJson(json);
}

@freezed
abstract class Loan with _$Loan {
  const factory Loan({
    required String id,
    required String clientId,
    required String contract,
    required LoanTerms terms,
    required int totalPayable,
    required int totalInterest,
    required double effectiveAnnualRate,
    required String status,
    required LoanSummary summary,
    @Default(0) int realizedProfit,
    String? expectedMethod,
    required String createdAt,
    required int version,
  }) = _Loan;

  factory Loan.fromJson(Map<String, dynamic> json) => _$LoanFromJson(json);
}

@freezed
abstract class Client with _$Client {
  const factory Client({
    required String id,
    required String code,
    required String firstName,
    required String lastName,
    required String fullName,
    required String phone,
    String? phone2,
    String? email,
    String? address,
    String? city,
    String? idDocType,
    String? idDocNumber,
    required String lang,
    String? collectorId,
    CoDebtor? coDebtor,
    String? notes,
    required String folderName,
    @Default(<Consent>[]) List<Consent> consents,
    @Default(<Loan>[]) List<Loan> loans,
    required String createdAt,
    required int version,
  }) = _Client;

  factory Client.fromJson(Map<String, dynamic> json) => _$ClientFromJson(json);
}

@freezed
abstract class ScheduledInstallment with _$ScheduledInstallment {
  const factory ScheduledInstallment({
    required int number,
    required String dueDate,
    required int amount,
    required int principal,
    required int interest,
    required int balanceAfter,
  }) = _ScheduledInstallment;

  factory ScheduledInstallment.fromJson(Map<String, dynamic> json) => _$ScheduledInstallmentFromJson(json);
}

@freezed
abstract class InstallmentState with _$InstallmentState {
  const factory InstallmentState({
    required int number,
    required String dueDate,
    required int amount,
    required int principal,
    required int interest,
    required int balanceAfter,
    required int paid,
    @Default(0) int lateFeeAccrued,
    @Default(0) int lateFeePaid,
    required String status,
    String? lastPaymentDate,
    @Default(<String>[]) List<String> receiptNumbers,
  }) = _InstallmentState;

  factory InstallmentState.fromJson(Map<String, dynamic> json) => _$InstallmentStateFromJson(json);
}

@freezed
abstract class RateCapCheck with _$RateCapCheck {
  const factory RateCapCheck({
    required bool ok,
    required double effectiveAnnual,
    double? cap,
    String? maxRate,
    @Default(false) bool missing,
  }) = _RateCapCheck;

  factory RateCapCheck.fromJson(Map<String, dynamic> json) => _$RateCapCheckFromJson(json);
}

@freezed
abstract class LoanPreview with _$LoanPreview {
  const factory LoanPreview({
    required List<ScheduledInstallment> installments,
    required int regularInstallment,
    required int totalPayable,
    required int totalInterest,
    required double effectiveAnnualRate,
    required RateCapCheck rateCap,
  }) = _LoanPreview;

  factory LoanPreview.fromJson(Map<String, dynamic> json) => _$LoanPreviewFromJson(json);
}

@freezed
abstract class AllocationLine with _$AllocationLine {
  const factory AllocationLine({
    required int number,
    @Default(0) int toLateFee,
    @Default(0) int toInstallment,
    @Default(false) bool completed,
    @Default(false) bool partial,
  }) = _AllocationLine;

  factory AllocationLine.fromJson(Map<String, dynamic> json) => _$AllocationLineFromJson(json);
}

@freezed
abstract class LedgerEntry with _$LedgerEntry {
  const factory LedgerEntry({
    required String id,
    required String type,
    required String entryDate,
    required String recordedAt,
    required int amount,
    @Default('') String method,
    @Default('') String reference,
    @Default('') String source,
    String? reversesId,
    String? reversedBy,
    @Default('') String reason,
    @Default('') String note,
    @Default(<AllocationLine>[]) List<AllocationLine> allocation,
    String? receiptNumber,
  }) = _LedgerEntry;

  factory LedgerEntry.fromJson(Map<String, dynamic> json) => _$LedgerEntryFromJson(json);
}

@freezed
abstract class ReceiptPayment with _$ReceiptPayment {
  const factory ReceiptPayment({required String date, required int amount, String? method, String? reference}) = _ReceiptPayment;
  factory ReceiptPayment.fromJson(Map<String, dynamic> json) => _$ReceiptPaymentFromJson(json);
}

@freezed
abstract class ReceiptNext with _$ReceiptNext {
  const factory ReceiptNext({required int number, required String dueDate, required int amount}) = _ReceiptNext;
  factory ReceiptNext.fromJson(Map<String, dynamic> json) => _$ReceiptNextFromJson(json);
}

@freezed
abstract class ReceiptData with _$ReceiptData {
  const factory ReceiptData({
    required String lang,
    required String number,
    required String issuedAt,
    required String contract,
    required String currency,
    required ReceiptPayment payment,
    required int totalInstallments,
    required String coverage,
    required int remainingInstallments,
    required int accumulatedPaid,
    required int previousBalance,
    required int newBalance,
    ReceiptNext? next,
    required String verificationCode,
    @Default(false) bool voided,
  }) = _ReceiptData;

  factory ReceiptData.fromJson(Map<String, dynamic> json) => _$ReceiptDataFromJson(json);
}

@freezed
abstract class PaymentResult with _$PaymentResult {
  const factory PaymentResult({required LedgerEntry entry, required ReceiptData receipt, @Default(0) int surplus, @Default(false) bool loanClosed}) = _PaymentResult;
  factory PaymentResult.fromJson(Map<String, dynamic> json) => _$PaymentResultFromJson(json);
}

@freezed
abstract class PaymentPreview with _$PaymentPreview {
  const factory PaymentPreview({
    @Default(<AllocationLine>[]) List<AllocationLine> lines,
    required String coverage,
    required int previousBalance,
    required int newBalance,
    required int remainingInstallments,
    @Default(0) int surplus,
    @Default(false) bool loanClosed,
  }) = _PaymentPreview;

  factory PaymentPreview.fromJson(Map<String, dynamic> json) => _$PaymentPreviewFromJson(json);
}

@freezed
abstract class ReceiptRecord with _$ReceiptRecord {
  const factory ReceiptRecord({
    required String number,
    required String entryId,
    @Default(false) bool voided,
    required String createdAt,
    required ReceiptData data,
    String? documentId,
    String? voidDocumentId,
  }) = _ReceiptRecord;
  factory ReceiptRecord.fromJson(Map<String, dynamic> json) => _$ReceiptRecordFromJson(json);
}

@freezed
abstract class TrendPoint with _$TrendPoint {
  const factory TrendPoint({required String date, required int amount}) = _TrendPoint;
  factory TrendPoint.fromJson(Map<String, dynamic> json) => _$TrendPointFromJson(json);
}

@freezed
abstract class AgingBucket with _$AgingBucket {
  const factory AgingBucket({@Default(0) int loans, @Default(0) int amount}) = _AgingBucket;
  factory AgingBucket.fromJson(Map<String, dynamic> json) => _$AgingBucketFromJson(json);
}

@freezed
abstract class Aging with _$Aging {
  const factory Aging({
    required AgingBucket current,
    @JsonKey(name: 'd1_7') required AgingBucket days1to7,
    @JsonKey(name: 'd8_30') required AgingBucket days8to30,
    @JsonKey(name: 'd30p') required AgingBucket over30,
  }) = _Aging;

  factory Aging.fromJson(Map<String, dynamic> json) => _$AgingFromJson(json);
}

@freezed
abstract class Dashboard with _$Dashboard {
  const factory Dashboard({
    required String currency,
    @Default(<String>[]) List<String> currencies,
    required String asOf,
    @Default(false) bool refreshing,
    required int clientsActive,
    required int clientsTotal,
    required int totalLent,
    required int totalLentHistoric,
    required int expectedToday,
    required int collectedToday,
    required int overdueTotal,
    required int totalReceivable,
    @Default(0) int lateFeesOutstanding,
    @Default(<TrendPoint>[]) List<TrendPoint> trend,
    required Aging aging,
  }) = _Dashboard;

  factory Dashboard.fromJson(Map<String, dynamic> json) => _$DashboardFromJson(json);
}

@freezed
abstract class TodayItem with _$TodayItem {
  const factory TodayItem({
    required String loanId,
    required String clientId,
    required String clientCode,
    required String clientName,
    required String phone,
    required String contract,
    required String currency,
    int? installmentNumber,
    String? dueDate,
    required int dueToday,
    required int overdue,
    required int amountToCollect,
    required int daysPastDue,
    required String status,
    required int balance,
  }) = _TodayItem;

  factory TodayItem.fromJson(Map<String, dynamic> json) => _$TodayItemFromJson(json);
}

@freezed
abstract class TodayCollections with _$TodayCollections {
  const factory TodayCollections({required String asOf, required List<TodayItem> items}) = _TodayCollections;
  factory TodayCollections.fromJson(Map<String, dynamic> json) => _$TodayCollectionsFromJson(json);
}

@freezed
abstract class RateCap with _$RateCap {
  const factory RateCap({required String id, required String country, required double effectiveAnnual, required String validFrom, required String validTo, required String source}) = _RateCap;
  factory RateCap.fromJson(Map<String, dynamic> json) => _$RateCapFromJson(json);
}

// ─────────────────────────── Fase 2 · Documentos (§15, §16, §18, §19) ───────────────────────────

/// Documento del repositorio (§16.1). Nunca se sobrescribe: las versiones nuevas reemplazan a las anteriores.
@freezed
abstract class CorocDocument with _$CorocDocument {
  const CorocDocument._();
  const factory CorocDocument({
    required String id,
    String? clientId,
    String? loanId,
    String? contract,
    required String kind,
    required String name,
    required String fileName,
    required String folderPath,
    required String mime,
    required int size,
    required String sha256,
    @Default(1) int version,
    @Default(false) bool superseded,
    @Default('system') String source,
    @Default(<String>[]) List<String> tags,
    String? lang,
    @Default(<String, dynamic>{}) Map<String, dynamic> meta,
    required String createdAt,
    required String updatedAt,
    @Default(<CorocDocument>[]) List<CorocDocument> versions,
  }) = _CorocDocument;

  factory CorocDocument.fromJson(Map<String, dynamic> json) => _$CorocDocumentFromJson(json);

  bool get isPdf => mime == 'application/pdf';
  bool get isImage => mime.startsWith('image/');
  bool get voided => meta['voided'] == true;
}

@freezed
abstract class DocumentPage with _$DocumentPage {
  const factory DocumentPage({@Default(<CorocDocument>[]) List<CorocDocument> items, String? nextCursor}) = _DocumentPage;
  factory DocumentPage.fromJson(Map<String, dynamic> json) => _$DocumentPageFromJson(json);
}

/// Enlace firmado de corta duración (§4.2). `path` es relativo a la base de la API.
@freezed
abstract class FileLink with _$FileLink {
  const factory FileLink({required String url, required String path, required String expiresAt}) = _FileLink;
  factory FileLink.fromJson(Map<String, dynamic> json) => _$FileLinkFromJson(json);
}

/// Tarea en segundo plano (estado de cuenta, informe).
@freezed
abstract class TaskInfo with _$TaskInfo {
  const TaskInfo._();
  const factory TaskInfo({required String id, required String kind, required String status, @Default(0) int progress, String? documentId, String? error, required String createdAt, String? finishedAt}) = _TaskInfo;
  factory TaskInfo.fromJson(Map<String, dynamic> json) => _$TaskInfoFromJson(json);
  bool get finished => status == 'done' || status == 'failed' || status == 'cancelled';
}

@freezed
abstract class ManifestClient with _$ManifestClient {
  const factory ManifestClient({required String id, required String code, required String folderName, required String marker, @Default(<String>[]) List<String> contracts}) = _ManifestClient;
  factory ManifestClient.fromJson(Map<String, dynamic> json) => _$ManifestClientFromJson(json);
}

@freezed
abstract class ManifestFile with _$ManifestFile {
  const factory ManifestFile({required String documentId, String? clientId, required String path, required int size, required String sha256, required String updatedAt}) = _ManifestFile;
  factory ManifestFile.fromJson(Map<String, dynamic> json) => _$ManifestFileFromJson(json);
}

/// Manifiesto de la carpeta COROC (§16.3): lo que el espejo local debe contener.
@freezed
abstract class FolderManifest with _$FolderManifest {
  const factory FolderManifest({
    required String lang,
    required bool full,
    required String generatedAt,
    required String nextSince,
    @Default(<String>[]) List<String> rootFolders,
    @Default(<String>[]) List<String> subfolders,
    @Default(<ManifestClient>[]) List<ManifestClient> clients,
    @Default(<ManifestFile>[]) List<ManifestFile> files,
    @Default(<String>[]) List<String> removed,
    String? nextPage,
  }) = _FolderManifest;
  factory FolderManifest.fromJson(Map<String, dynamic> json) => _$FolderManifestFromJson(json);
}

/// Respaldo `.coroc` (§19).
@freezed
abstract class BackupInfo with _$BackupInfo {
  const BackupInfo._();
  const factory BackupInfo({
    required String id,
    required String status,
    @Default(0) int progress,
    String? fileName,
    int? size,
    String? sha256,
    @Default(<String, int>{}) Map<String, int> counts,
    required String createdAt,
    String? finishedAt,
  }) = _BackupInfo;
  factory BackupInfo.fromJson(Map<String, dynamic> json) => _$BackupInfoFromJson(json);
  bool get running => status == 'pending' || status == 'running';
}

@freezed
abstract class RestoreSummary with _$RestoreSummary {
  const factory RestoreSummary({
    required String company,
    required String createdAt,
    required String format,
    required String schema,
    @Default(<String, int>{}) Map<String, int> counts,
    @Default(0) int documents,
    @Default(0) int bytes,
  }) = _RestoreSummary;
  factory RestoreSummary.fromJson(Map<String, dynamic> json) => _$RestoreSummaryFromJson(json);
}

@freezed
abstract class RestoreInfo with _$RestoreInfo {
  const factory RestoreInfo({required String id, required String status, int? size, RestoreSummary? summary, required String createdAt, String? appliedAt}) = _RestoreInfo;
  factory RestoreInfo.fromJson(Map<String, dynamic> json) => _$RestoreInfoFromJson(json);
}

// ─────────────────────────── Fase 3 · Recepción y lectura (§12, §13) ───────────────────────────

/// Dónde se leyó un campo, en fracciones de la página (0–1), para resaltarlo sobre la imagen (§13.6).
@freezed
abstract class FieldRegion with _$FieldRegion {
  const factory FieldRegion({@Default(0) int page, required double x, required double y, required double w, required double h}) = _FieldRegion;
  factory FieldRegion.fromJson(Map<String, dynamic> json) => _$FieldRegionFromJson(json);
}

/// Campo leído del comprobante con su confianza (0–1).
@freezed
abstract class ExtractedValue with _$ExtractedValue {
  const factory ExtractedValue({Object? value, @Default(0) double confidence, FieldRegion? region}) = _ExtractedValue;
  factory ExtractedValue.fromJson(Map<String, dynamic> json) => _$ExtractedValueFromJson(json);
}

@freezed
abstract class IntakeFlag with _$IntakeFlag {
  const IntakeFlag._();
  const factory IntakeFlag({required String code, String? field, String? detail, @Default('blocking') String severity}) = _IntakeFlag;
  factory IntakeFlag.fromJson(Map<String, dynamic> json) => _$IntakeFlagFromJson(json);
  bool get blocking => severity == 'blocking';
}

@freezed
abstract class IntakeCandidate with _$IntakeCandidate {
  const factory IntakeCandidate({required String clientId, @Default(0) double score, @Default(<String>[]) List<String> reasons, String? name, String? code}) = _IntakeCandidate;
  factory IntakeCandidate.fromJson(Map<String, dynamic> json) => _$IntakeCandidateFromJson(json);
}

@freezed
abstract class IntakeIdentification with _$IntakeIdentification {
  const factory IntakeIdentification({
    @Default('unknown') String status,
    String? clientId,
    String? via,
    String? loanRule,
    String? duplicateOf,
    @Default(<IntakeCandidate>[]) List<IntakeCandidate> candidates,
  }) = _IntakeIdentification;
  factory IntakeIdentification.fromJson(Map<String, dynamic> json) => _$IntakeIdentificationFromJson(json);
}

/// Comprobante recibido por un canal (§12) y su lectura (§13). Es un elemento de la Bandeja de validación.
@freezed
abstract class IntakeItem with _$IntakeItem {
  const IntakeItem._();
  const factory IntakeItem({
    required String id,
    required String channel,
    String? senderPhone,
    String? senderEmail,
    String? messageText,
    required String documentId,
    String? fileName,
    String? mime,
    required String status,
    required String stage,
    String? engine,
    @Default(<String, dynamic>{}) Map<String, dynamic> extraction,
    @Default(IntakeIdentification()) IntakeIdentification identification,
    @Default(<IntakeFlag>[]) List<IntakeFlag> flags,
    String? clientId,
    String? clientName,
    String? clientCode,
    String? loanId,
    String? contract,
    String? currency,
    String? entryId,
    String? receiptNumber,
    String? receiptDocumentId,
    String? revertibleUntil,
    String? reason,
    String? decidedBy,
    String? decidedAt,
    required String createdAt,
    String? updatedAt,
  }) = _IntakeItem;
  factory IntakeItem.fromJson(Map<String, dynamic> json) => _$IntakeItemFromJson(json);

  /// Campo leído (`amount`, `date`, `payerName`, `receiverName`, `reference`, `entity`…).
  ExtractedValue field(String name) {
    final raw = extraction[name];
    return raw is Map<String, dynamic> ? ExtractedValue.fromJson(raw) : const ExtractedValue();
  }

  int? get amount => (field('amount').value as num?)?.toInt();
  String? get date => field('date').value as String?;
  String? text(String name) => field(name).value as String?;
  List<String> get tamperSignals => (extraction['tamperSignals'] as List<dynamic>? ?? const []).cast<String>();
  bool get pending => status == 'review' || status == 'unassigned';
  bool get isPdf => mime == 'application/pdf';
  bool get revertible => status == 'applied_auto' && revertibleUntil != null && DateTime.parse(revertibleUntil!).isAfter(DateTime.now());
  bool get hasBlocking => flags.any((f) => f.blocking);
}

@freezed
abstract class IntakePage with _$IntakePage {
  const factory IntakePage({@Default(<IntakeItem>[]) List<IntakeItem> items, String? nextCursor}) = _IntakePage;
  factory IntakePage.fromJson(Map<String, dynamic> json) => _$IntakePageFromJson(json);
}

@freezed
abstract class IntakeSummary with _$IntakeSummary {
  const factory IntakeSummary({@Default(0) int review, @Default(0) int unassigned, @Default(0) int processing, @Default(0) int revertible, @Default(0) int pending}) = _IntakeSummary;
  factory IntakeSummary.fromJson(Map<String, dynamic> json) => _$IntakeSummaryFromJson(json);
}

/// Enlace personal de carga del préstamo (§12.3).
@freezed
abstract class UploadLink with _$UploadLink {
  const factory UploadLink({required String url, required String expiresAt, required String createdAt, @Default(0) int uses, String? lastUsedAt}) = _UploadLink;
  factory UploadLink.fromJson(Map<String, dynamic> json) => _$UploadLinkFromJson(json);
}

/// Cuenta de la empresa donde los deudores pagan (§13.4): el beneficiario del comprobante debe coincidir con alguna.
@freezed
abstract class ReceivingAccount with _$ReceivingAccount {
  const factory ReceivingAccount({required String id, required String holderName, String? institution, String? last4, @Default(true) bool active}) = _ReceivingAccount;
  factory ReceivingAccount.fromJson(Map<String, dynamic> json) => _$ReceivingAccountFromJson(json);
}

/// Número de WhatsApp Business que recibe comprobantes (§12.1). El token nunca vuelve del servidor.
@freezed
abstract class WhatsAppAccount with _$WhatsAppAccount {
  const factory WhatsAppAccount({
    @Default(false) bool configured,
    String? phoneNumberId,
    String? displayNumber,
    @Default(false) bool active,
    String? updatedAt,
    required String webhookUrl,
    @Default(false) bool serverReady,
  }) = _WhatsAppAccount;
  factory WhatsAppAccount.fromJson(Map<String, dynamic> json) => _$WhatsAppAccountFromJson(json);
}
