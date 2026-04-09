.PHONY: run build-apk build-ios clean codegen

# Default run on attached device/emulator
run:
	flutter run

# Generates Freezed and Isar files
codegen:
	flutter pub run build_runner build --delete-conflicting-outputs

build-apk:
	flutter build apk --release

build-ios:
	flutter build ios --release

clean:
	flutter clean
	flutter pub get
