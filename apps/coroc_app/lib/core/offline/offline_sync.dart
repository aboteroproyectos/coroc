import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_exception.dart';
import '../auth/auth_controller.dart';
import '../providers.dart';
import 'offline_store.dart';

final offlineVaultProvider = Provider<OfflineVault>((ref) => FileVault());
final offlineCacheProvider = Provider<OfflineCache>((ref) => OfflineCache(ref.watch(offlineVaultProvider)));
final paymentQueueProvider = Provider<PaymentQueue>((ref) => PaymentQueue(ref.watch(offlineVaultProvider)));

class OfflineState {
  const OfflineState({this.online = true, this.savedAt, this.pending = const [], this.syncing = false});
  final bool online;

  /// Hora de la lectura guardada que se está mostrando sin conexión.
  final DateTime? savedAt;
  final List<PendingPayment> pending;
  final bool syncing;

  List<PendingPayment> get conflicts => pending.where((p) => p.inConflict).toList();
  List<PendingPayment> get waiting => pending.where((p) => !p.inConflict).toList();

  OfflineState copyWith({bool? online, DateTime? savedAt, bool clearSavedAt = false, List<PendingPayment>? pending, bool? syncing}) => OfflineState(
        online: online ?? this.online,
        savedAt: clearSavedAt ? null : (savedAt ?? this.savedAt),
        pending: pending ?? this.pending,
        syncing: syncing ?? this.syncing,
      );
}

/// Cola de pagos sin conexión y estado de la red (ADR-055).
///
/// Resolución de conflictos: el servidor manda. Cada pago pendiente se reenvía con su misma clave de idempotencia,
/// así que si el primer intento sí llegó, el servidor responde con el mismo resultado y no lo duplica. Si al volver la
/// red el servidor lo rechaza (préstamo cerrado, monto mayor al saldo, cliente reasignado, sin permiso…), el pago
/// queda «En conflicto» con el motivo del servidor y la persona decide: revisar el préstamo o descartarlo. Nada se
/// descarta solo. Los errores del servidor (5xx) y la falta de red dejan el pago en cola para el próximo intento.
class OfflineController extends Notifier<OfflineState> {
  Timer? _timer;

  @override
  OfflineState build() {
    ref.onDispose(() => _timer?.cancel());
    unawaited(_reload());
    return const OfflineState();
  }

  Future<void> _reload() async {
    try {
      final items = await ref.read(paymentQueueProvider).all();
      state = state.copyWith(pending: List.of(items));
      _schedule();
    } on Object {
      // Sin almacén (pruebas o plataforma sin soporte): la cola queda vacía.
    }
  }

  void _schedule() {
    _timer?.cancel();
    if (state.waiting.isEmpty) return;
    _timer = Timer.periodic(const Duration(minutes: 1), (_) => unawaited(flush()));
  }

  /// Lo llama el cliente HTTP en cada respuesta o fallo de red.
  void connectivity(bool online, DateTime? savedAt) {
    final wasOffline = !state.online;
    state = online ? state.copyWith(online: true, clearSavedAt: true) : state.copyWith(online: false, savedAt: savedAt);
    if (online && wasOffline) unawaited(flush());
  }

  Future<void> enqueue(PendingPayment p) async {
    final q = ref.read(paymentQueueProvider);
    await q.add(p);
    state = state.copyWith(pending: List.of(await q.all()), online: false);
    _schedule();
  }

  /// Envía los pagos pendientes del usuario actual, en el orden en que se registraron.
  Future<int> flush({String? asUser}) async {
    if (state.syncing) return 0;
    final auth = ref.read(authProvider);
    final userId = asUser ?? (auth is SignedIn ? auth.user.id : null);
    if (userId == null) return 0;
    final q = ref.read(paymentQueueProvider);
    state = state.copyWith(syncing: true);
    var sent = 0;
    try {
      for (final p in List.of(await q.all())) {
        if (p.inConflict || p.userId != userId) continue;
        try {
          await ref.read(apiProvider).replayPayment(p.loanId, amount: p.amount, date: p.date, idempotencyKey: p.key, method: p.method, reference: p.reference, note: p.note, cash: p.cash);
          await q.remove(p.key);
          sent++;
        } on ApiException catch (e) {
          if (e.isNetwork || e.status >= 500 || e.status == 401 || e.code == 'IDEMPOTENCY_IN_PROGRESS') break;
          await q.markConflict(p.key, e.code, e.detail ?? e.title);
        }
      }
    } finally {
      state = state.copyWith(syncing: false, pending: List.of(await q.all()));
      _schedule();
    }
    return sent;
  }

  Future<void> discard(String key) async {
    final q = ref.read(paymentQueueProvider);
    await q.remove(key);
    state = state.copyWith(pending: List.of(await q.all()));
  }
}

final offlineProvider = NotifierProvider<OfflineController, OfflineState>(OfflineController.new);
