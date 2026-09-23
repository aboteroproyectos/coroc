import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/models.dart';
import '../../core/providers.dart';

final clientProvider = FutureProvider.autoDispose.family<Client, String>((ref, id) => ref.watch(apiProvider).clientById(id));
final loanProvider = FutureProvider.autoDispose.family<Loan, String>((ref, id) => ref.watch(apiProvider).loan(id));
final scheduleProvider = FutureProvider.autoDispose.family<List<InstallmentState>, String>((ref, id) => ref.watch(apiProvider).schedule(id));
final ledgerProvider = FutureProvider.autoDispose.family<List<LedgerEntry>, String>((ref, id) => ref.watch(apiProvider).ledger(id));
final receiptsProvider = FutureProvider.autoDispose.family<List<ReceiptRecord>, String>((ref, id) => ref.watch(apiProvider).receipts(id));
final usersProvider = FutureProvider.autoDispose<List<User>>((ref) => ref.watch(apiProvider).users());
final companyProvider = FutureProvider.autoDispose<Company>((ref) => ref.watch(apiProvider).company());
final rateCapsProvider = FutureProvider.autoDispose<List<RateCap>>((ref) => ref.watch(apiProvider).rateCaps());
final mySessionsProvider = FutureProvider.autoDispose<List<SessionInfo>>((ref) => ref.watch(apiProvider).mySessions());
