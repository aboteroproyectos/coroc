import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_client.dart';
import '../core/auth/auth_controller.dart';
import '../core/format.dart';
import '../core/l10n.dart';
import '../core/models/models.dart';
import '../core/providers.dart';
import '../features/dashboard/dashboard_page.dart' show dashboardProvider, eventsProvider, todayProvider;
import '../features/inbox/inbox_page.dart' show intakeSummaryProvider;
import '../features/loans/loan_providers.dart' show clientProvider, ledgerProvider, scheduleProvider;
import '../features/messaging/messaging_common.dart' show messagesSummaryProvider;

/// Datos del nuevo COROC (Fase 11). Lo demás (tablero, cobros de hoy, resúmenes, clientes) viene de la app completa.

/// Movimientos recientes de Inicio: los últimos pagos de la cartera, como el extracto de un banco.
final recentPaymentsProvider = FutureProvider.autoDispose<List<RecentPayment>>((ref) => ref.watch(apiProvider).recentPayments(limit: 12));

/// Comprobantes que COROC no pudo registrar solo y esperan una respuesta de la persona (y los que aún se leen).
final pendingReceiptsProvider = FutureProvider.autoDispose<IntakePage>((ref) => ref.watch(apiProvider).intake(status: const ['processing', 'review', 'unassigned'], limit: 50));

/// Los que COROC registró solo hace poco: se pueden deshacer durante 72 horas.
final autoReceiptsProvider = FutureProvider.autoDispose<IntakePage>((ref) => ref.watch(apiProvider).intake(status: const ['applied_auto'], limit: 20));

/// Mensajes listos para enviar por WhatsApp (recibos, recordatorios, estados de cuenta), uno a la vez.
final readyMessagesProvider = FutureProvider.autoDispose<MessagePage>((ref) => ref.watch(apiProvider).messages(status: const ['ready'], limit: 100));

/// Clientes con búsqueda y filtro de estado.
typedef ClientsQuery = ({String q, String? status});
final clientsProvider = FutureProvider.autoDispose.family<ClientPage, ClientsQuery>(
  (ref, query) => ref.watch(apiProvider).clients(q: query.q.trim().isEmpty ? null : query.q.trim(), status: query.status, limit: 200),
);

/// Primer nombre de quien usa COROC, para saludar.
String firstName(String name) => name.trim().split(RegExp(r'\s+')).first;

/// Saludo según la hora: «Buenos días», «Buenas tardes» o «Buenas noches».
String greeting(AppLocalizations l, DateTime now) => now.hour < 12 ? l.pGreetingMorning : (now.hour < 19 ? l.pGreetingAfternoon : l.pGreetingEvening);

/// Refresca todo lo que cambió cuando COROC registra un pago, llega un comprobante o sale un mensaje, y avisa con
/// discreción: «Pago registrado: María Pérez · $ 60.000».
class PersonalRealtime extends ConsumerWidget {
  const PersonalRealtime({super.key, required this.child});
  final Widget child;

  static void refreshMoney(WidgetRef ref, {String? clientId}) {
    ref
      ..invalidate(dashboardProvider)
      ..invalidate(todayProvider)
      ..invalidate(recentPaymentsProvider)
      ..invalidate(clientsProvider);
    if (clientId != null) ref.invalidate(clientProvider(clientId));
    ref
      ..invalidate(scheduleProvider)
      ..invalidate(ledgerProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AsyncValue<ServerEvent>>(eventsProvider, (_, next) {
      final e = next.valueOrNull;
      if (e == null) return;
      switch (e.type) {
        case 'payment.posted' || 'payment.reversed' || 'loan.created' || 'dashboard.changed':
          refreshMoney(ref, clientId: e.data['clientId'] as String?);
          if (e.type == 'payment.posted') {
            final amount = (e.data['amount'] as num?)?.toInt() ?? 0;
            final currency = ref.read(sessionProvider)?.company.currency ?? 'COP';
            ScaffoldMessenger.maybeOf(
              context,
            )?.showSnackBar(SnackBar(content: Text(context.l10n.realtimePayment(e.data['clientName'] as String? ?? '', Money.format(amount, currency))), duration: const Duration(seconds: 4)));
          }
        case 'intake.updated':
          ref
            ..invalidate(intakeSummaryProvider)
            ..invalidate(pendingReceiptsProvider)
            ..invalidate(autoReceiptsProvider);
        case 'message.updated':
          ref
            ..invalidate(messagesSummaryProvider)
            ..invalidate(readyMessagesProvider)
            ..invalidate(recentPaymentsProvider);
      }
    });
    return child;
  }
}
