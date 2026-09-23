/// Soporte (Fase 5, ADR-054): cola de fallidos y traza de un comprobante. Clases simples, sin generación de código.
typedef Json = Map<String, dynamic>;

class FailedTask {
  const FailedTask({required this.id, required this.kind, this.contract, this.detail, required this.attempts, required this.retryable, this.finishedAt});
  factory FailedTask.fromJson(Json j) => FailedTask(
        id: j['id'] as String,
        kind: j['kind'] as String,
        contract: j['contract'] as String?,
        detail: j['detail'] as String?,
        attempts: (j['attempts'] as num).toInt(),
        retryable: j['retryable'] as bool,
        finishedAt: j['finishedAt'] as String?,
      );
  final String id;
  final String kind;
  final String? contract;
  final String? detail;
  final int attempts;
  final bool retryable;
  final String? finishedAt;
}

class FailedMessage {
  const FailedMessage({required this.id, required this.clientName, required this.event, required this.channel, this.detail, this.failedAt});
  factory FailedMessage.fromJson(Json j) => FailedMessage(
        id: j['id'] as String,
        clientName: j['clientName'] as String,
        event: j['event'] as String,
        channel: j['channel'] as String,
        detail: j['detail'] as String?,
        failedAt: j['failedAt'] as String?,
      );
  final String id;
  final String clientName;
  final String event;
  final String channel;
  final String? detail;
  final String? failedAt;
}

class FailedIntake {
  const FailedIntake({required this.id, required this.channel, this.fileName, this.detail, required this.createdAt});
  factory FailedIntake.fromJson(Json j) => FailedIntake(
        id: j['id'] as String,
        channel: j['channel'] as String,
        fileName: j['fileName'] as String?,
        detail: j['detail'] as String?,
        createdAt: j['createdAt'] as String,
      );
  final String id;
  final String channel;
  final String? fileName;
  final String? detail;
  final String createdAt;
}

class Failures {
  const Failures({required this.days, required this.tasks, required this.messages, required this.intake});
  factory Failures.fromJson(Json j) => Failures(
        days: (j['days'] as num).toInt(),
        tasks: (j['documentTasks'] as List).cast<Json>().map(FailedTask.fromJson).toList(),
        messages: (j['messages'] as List).cast<Json>().map(FailedMessage.fromJson).toList(),
        intake: (j['intake'] as List).cast<Json>().map(FailedIntake.fromJson).toList(),
      );
  final int days;
  final List<FailedTask> tasks;
  final List<FailedMessage> messages;
  final List<FailedIntake> intake;
  bool get isEmpty => tasks.isEmpty && messages.isEmpty && intake.isEmpty;
}

class TraceStep {
  const TraceStep({required this.step, required this.status, this.at, this.detail});
  factory TraceStep.fromJson(Json j) => TraceStep(step: j['step'] as String, status: j['status'] as String, at: j['at'] as String?, detail: j['detail'] as String?);
  final String step;
  final String status;
  final String? at;
  final String? detail;
}

class IntakeTrace {
  const IntakeTrace({required this.steps, this.paymentSeconds, this.deliveredSeconds});
  factory IntakeTrace.fromJson(Json j) => IntakeTrace(
        steps: (j['steps'] as List).cast<Json>().map(TraceStep.fromJson).toList(),
        paymentSeconds: (j['paymentSeconds'] as num?)?.toInt(),
        deliveredSeconds: (j['deliveredSeconds'] as num?)?.toInt(),
      );
  final List<TraceStep> steps;
  final int? paymentSeconds;
  final int? deliveredSeconds;
}
