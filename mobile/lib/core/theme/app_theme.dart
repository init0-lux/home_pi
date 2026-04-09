import 'package:flutter/material.dart';
import 'colors.dart';
import 'typography.dart';

class AppTheme {
  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      primaryColor: ZappColors.primary,
      scaffoldBackgroundColor: ZappColors.backgroundDark,
      colorScheme: const ColorScheme.dark(
        primary: ZappColors.primary,
        surface: ZappColors.surfaceDark,
        surfaceContainerHighest: ZappColors.surfaceVariantDark, // Replaced surfaceVariant
        onSurface: ZappColors.onSurface,
        onSurfaceVariant: ZappColors.onSurfaceVariant,
        error: ZappColors.offlineIndicator,
      ),
      textTheme: ZappTypography.getTextTheme(isDark: true),
      cardTheme: CardTheme(
        color: ZappColors.surfaceDark,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ZappColors.primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      primaryColor: ZappColors.primary,
      scaffoldBackgroundColor: ZappColors.backgroundLight,
      colorScheme: const ColorScheme.light(
        primary: ZappColors.primary,
        surface: ZappColors.surfaceLight,
        surfaceContainerHighest: ZappColors.surfaceVariantLight, // Replaced surfaceVariant
        onSurface: ZappColors.onSurfaceLight,
        onSurfaceVariant: ZappColors.onSurfaceVariantLight,
        error: ZappColors.offlineIndicator,
      ),
      textTheme: ZappTypography.getTextTheme(isDark: false),
      cardTheme: CardTheme(
        color: ZappColors.surfaceLight,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ZappColors.primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}
