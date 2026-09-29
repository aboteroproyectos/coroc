import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'tokens.dart';

/// Temas «Marfil» (claro) y «Medianoche» (oscuro) (§5.4). Tipografía: Montserrat en titulares y etiquetas,
/// Inter con cifras tabulares en textos y montos (§5.3). Escala 12/14/16/20/24/32/44/56.
abstract final class CorocTheme {
  static const _tabular = [FontFeature.tabularFigures()];

  static TextTheme _text(Color ink, Color muted) => TextTheme(
    displayLarge: TextStyle(fontFamily: 'Inter', fontSize: 56, fontWeight: FontWeight.w400, height: 1.05, color: ink, fontFeatures: _tabular),
    displayMedium: TextStyle(fontFamily: 'Inter', fontSize: 44, fontWeight: FontWeight.w400, height: 1.1, color: ink, fontFeatures: _tabular),
    displaySmall: TextStyle(fontFamily: 'Inter', fontSize: 32, fontWeight: FontWeight.w400, height: 1.15, color: ink, fontFeatures: _tabular),
    headlineLarge: TextStyle(fontFamily: 'Montserrat', fontSize: 32, fontWeight: FontWeight.w600, height: 1.2, color: ink),
    headlineMedium: TextStyle(fontFamily: 'Montserrat', fontSize: 24, fontWeight: FontWeight.w600, height: 1.25, color: ink),
    headlineSmall: TextStyle(fontFamily: 'Montserrat', fontSize: 20, fontWeight: FontWeight.w600, height: 1.3, color: ink),
    titleLarge: TextStyle(fontFamily: 'Montserrat', fontSize: 20, fontWeight: FontWeight.w600, color: ink),
    titleMedium: TextStyle(fontFamily: 'Montserrat', fontSize: 16, fontWeight: FontWeight.w600, color: ink),
    titleSmall: TextStyle(fontFamily: 'Montserrat', fontSize: 14, fontWeight: FontWeight.w600, color: ink),
    bodyLarge: TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w400, height: 1.45, color: ink, fontFeatures: _tabular),
    bodyMedium: TextStyle(fontFamily: 'Inter', fontSize: 14, fontWeight: FontWeight.w400, height: 1.45, color: ink, fontFeatures: _tabular),
    bodySmall: TextStyle(fontFamily: 'Inter', fontSize: 12, fontWeight: FontWeight.w400, height: 1.4, color: muted, fontFeatures: _tabular),
    // Etiquetas en mayúsculas con tracking de 0,18 em, en el espíritu de «PERSONAL LOANS».
    labelLarge: TextStyle(fontFamily: 'Montserrat', fontSize: 14, fontWeight: FontWeight.w600, color: ink),
    labelMedium: TextStyle(fontFamily: 'Montserrat', fontSize: 12, fontWeight: FontWeight.w500, letterSpacing: 12 * 0.18, color: muted),
    labelSmall: TextStyle(fontFamily: 'Montserrat', fontSize: 11, fontWeight: FontWeight.w500, letterSpacing: 11 * 0.18, color: muted),
  );

  static ThemeData light() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: CorocColors.navy800,
      onPrimary: CorocColors.ivory,
      secondary: CorocColors.gold800,
      onSecondary: Colors.white,
      tertiary: CorocColors.gold700,
      onTertiary: CorocColors.navy800,
      error: CorocColors.error,
      onError: Colors.white,
      surface: CorocColors.surface,
      onSurface: CorocColors.navy800,
      onSurfaceVariant: CorocColors.inkMutedLight,
      outline: CorocColors.hairlineLight,
      outlineVariant: CorocColors.hairlineLight,
      surfaceContainerHighest: Color(0xFFF1EFE8),
      surfaceContainerHigh: Color(0xFFF6F4EE),
      surfaceContainer: Color(0xFFF9F8F4),
      surfaceContainerLow: Color(0xFFFCFBF8),
      surfaceContainerLowest: Colors.white,
    );
    return _base(scheme, CorocColors.paper, CorocColors.hairlineLight, _text(CorocColors.navy800, CorocColors.inkMutedLight));
  }

  static ThemeData dark() {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: CorocColors.gold300,
      onPrimary: CorocColors.navy900,
      secondary: CorocColors.gold300,
      onSecondary: CorocColors.navy900,
      tertiary: CorocColors.gold500,
      onTertiary: CorocColors.navy900,
      error: Color(0xFFF2B8B5),
      onError: Color(0xFF601410),
      surface: CorocColors.navy800,
      onSurface: CorocColors.ivory,
      onSurfaceVariant: CorocColors.inkMutedDark,
      outline: Color(0x33FFFDE7),
      outlineVariant: Color(0x22FFFDE7),
      surfaceContainerHighest: CorocColors.navy600,
      surfaceContainerHigh: Color(0xFF231D5E),
      surfaceContainer: CorocColors.navy700,
      surfaceContainerLow: Color(0xFF17124A),
      surfaceContainerLowest: CorocColors.navy900,
    );
    return _base(scheme, CorocColors.navy900, const Color(0x33FFFDE7), _text(CorocColors.ivory, CorocColors.inkMutedDark));
  }

  static ThemeData _base(ColorScheme scheme, Color background, Color hairline, TextTheme text) {
    final controlShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(CorocRadii.control));
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      fontFamily: 'Inter',
      textTheme: text,
      dividerColor: hairline,
      dividerTheme: DividerThemeData(color: hairline, thickness: 1, space: 1),
      cardTheme: CardThemeData(
        color: scheme.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CorocRadii.card),
          side: BorderSide(color: hairline),
        ),
      ),
      appBarTheme: AppBarTheme(backgroundColor: background, foregroundColor: scheme.onSurface, elevation: 0, scrolledUnderElevation: 0, centerTitle: false, titleTextStyle: text.titleLarge),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: const Size(44, 48), shape: controlShape, textStyle: text.labelLarge),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(44, 48),
          shape: controlShape,
          side: BorderSide(color: hairline),
          foregroundColor: scheme.onSurface,
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: const Size(44, 44), shape: controlShape, foregroundColor: scheme.secondary, textStyle: text.labelLarge),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.brightness == Brightness.light ? CorocColors.navy800 : CorocColors.navy600,
        contentTextStyle: text.bodyMedium?.copyWith(color: CorocColors.ivory),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(CorocRadii.control)),
      ),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
        },
      ),
    );
  }
}

/// Campo de formulario con el estilo de COROC (bordes de 12 px y filete fino).
InputDecoration corocInput(BuildContext context, {required String label, String? hint, String? helper, String? error, Widget? prefix, Widget? suffix}) {
  final scheme = Theme.of(context).colorScheme;
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(CorocRadii.control),
    borderSide: BorderSide(color: c, width: w),
  );
  return InputDecoration(
    labelText: label,
    hintText: hint,
    helperText: helper,
    errorText: error,
    helperMaxLines: 3,
    errorMaxLines: 3,
    prefixIcon: prefix,
    suffixIcon: suffix,
    filled: true,
    fillColor: scheme.surface,
    border: border(scheme.outline),
    enabledBorder: border(scheme.outline),
    focusedBorder: border(scheme.secondary, 1.5),
    errorBorder: border(scheme.error),
    focusedErrorBorder: border(scheme.error, 1.5),
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
  );
}
