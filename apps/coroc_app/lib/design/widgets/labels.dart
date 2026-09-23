import '../../core/l10n.dart';
import 'common.dart';

/// Textos y tonos de los estados del dominio (§9.5, §10). Siempre con texto, nunca solo color.
(String, StatusTone) installmentStatus(AppLocalizations l, String s) => switch (s) {
      'paid' => (l.statusPaid, StatusTone.ok),
      'partial' => (l.statusPartial, StatusTone.info),
      'overdue' => (l.statusOverdue, StatusTone.error),
      'waived' => (l.statusWaived, StatusTone.neutral),
      _ => (l.statusPending, StatusTone.neutral),
    };

(String, StatusTone) clientStatus(AppLocalizations l, String s) => switch (s) {
      'overdue' => (l.clientOverdue, StatusTone.error),
      'closed' => (l.clientClosed, StatusTone.neutral),
      _ => (l.clientCurrent, StatusTone.ok),
    };

String frequencyLabel(AppLocalizations l, String? f) => switch (f) {
      'daily' => l.freqDaily,
      'weekly' => l.freqWeekly,
      'monthly' => l.freqMonthly,
      _ => '—',
    };

String methodLabel(AppLocalizations l, String m) => m == 'french' ? l.methodFrench : l.methodSimple;

String entryType(AppLocalizations l, String t) => switch (t) {
      'disbursement' => l.entryDisbursement,
      'payment' => l.entryPayment,
      'reversal' => l.entryReversal,
      'late_fee' => l.entryLateFee,
      'waiver' => l.entryWaiver,
      'adjustment' => l.entryAdjustment,
      _ => t,
    };

String languageName(AppLocalizations l, String code) => switch (code) {
      'pt' || 'pt-BR' => l.langPt,
      'en' => l.langEn,
      _ => l.langEs,
    };

List<String> weekdayShort(AppLocalizations l) => [l.dayMon, l.dayTue, l.dayWed, l.dayThu, l.dayFri, l.daySat, l.daySun];
