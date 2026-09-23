import 'package:flutter/material.dart';

/// Tokens del sistema de diseño de COROC (§5.2), muestreados del logo.
abstract final class CorocColors {
  static const navy900 = Color(0xFF0B0826);
  static const navy800 = Color(0xFF130E42);
  static const navy700 = Color(0xFF1C1655);
  static const navy600 = Color(0xFF2A2466);
  static const gold800 = Color(0xFF8A6A2B); // único dorado para texto normal sobre fondo claro (5,0:1)
  static const gold700 = Color(0xFFA57E33);
  static const gold500 = Color(0xFFCAA555);
  static const gold300 = Color(0xFFE9C879);
  static const ivory = Color(0xFFFFFDE7);
  static const paper = Color(0xFFF6F6F6);
  static const surface = Color(0xFFFFFFFF);
  static const inkMutedLight = Color(0xFF5B5878);
  static const inkMutedDark = Color(0xFFB8B4D6);
  static const hairlineLight = Color(0xFFE8E4D8);
  static const success = Color(0xFF2E7D5B);
  static const warning = Color(0xFFB7791F);
  static const error = Color(0xFFB3261E);
  static const info = Color(0xFF2B5CAB);

  /// Degradado de marca: solo botón primario, isotipo, anillo de progreso y cifra protagonista (§5.2).
  static const brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [gold700, gold500, gold300, gold700],
    stops: [0, 0.45, 0.70, 1],
  );
}

abstract final class CorocRadii {
  static const card = 16.0;
  static const control = 12.0;
}

abstract final class CorocSpace {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 48.0;
}

/// Movimiento (§5.5): 180–320 ms con easeOutCubic; conteo de cifras en 900 ms.
abstract final class CorocMotion {
  static const fast = Duration(milliseconds: 180);
  static const normal = Duration(milliseconds: 240);
  static const slow = Duration(milliseconds: 320);
  static const countUp = Duration(milliseconds: 900);
  static const curve = Curves.easeOutCubic;
}

/// Puntos de quiebre del diseño adaptable (§5.6).
abstract final class CorocBreakpoints {
  static const tablet = 640.0;
  static const desktop = 1100.0;
}
