#
# To learn more about a Podspec see http://guides.cocoapods.org/syntax/podspec.html.
# Run `pod lib lint coroc_bookmarks.podspec` to validate before publishing.
#
Pod::Spec.new do |s|
  s.name             = 'coroc_bookmarks'
  s.version          = '1.0.0'
  s.summary          = 'Carpeta COROC en macOS con marcador de seguridad.'
  s.description      = <<-DESC
Carpeta COROC en macOS con marcador de seguridad.
                       DESC
  s.homepage         = 'https://coroc.app'
  s.license          = { :file => '../LICENSE' }
  s.author           = { 'COROC' => 'soporte@coroc.app' }

  s.source           = { :path => '.' }
  s.source_files = 'coroc_bookmarks/Sources/coroc_bookmarks/**/*'

  # If your plugin requires a privacy manifest, for example if it collects user
  # data, update the PrivacyInfo.xcprivacy file to describe your plugin's
  # privacy impact, and then uncomment this line. For more information,
  # see https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
  # s.resource_bundles = {'coroc_bookmarks_privacy' => ['coroc_bookmarks/Sources/coroc_bookmarks/PrivacyInfo.xcprivacy']}

  s.dependency 'FlutterMacOS'

  s.platform = :osx, '13.0'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.swift_version = '5.0'
end
