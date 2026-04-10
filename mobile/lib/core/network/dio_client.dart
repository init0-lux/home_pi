import 'package:dio/dio.dart';
import '../config/constants.dart';
import 'auth_interceptor.dart';
import 'error_interceptor.dart';

class DioClient {
  late final Dio _dio;

  DioClient({
    required AuthInterceptor authInterceptor,
    required ErrorInterceptor errorInterceptor,
  }) {
    _dio = Dio(
      BaseOptions(
        connectTimeout: AppConstants.connectionTimeout,
        receiveTimeout: AppConstants.receiveTimeout,
        responseType: ResponseType.json,
        contentType: 'application/json',
      ),
    );

    _dio.interceptors.addAll([
      authInterceptor,
      errorInterceptor,
      LogInterceptor(responseBody: true, requestBody: true),
    ]);
  }

  Dio get dio => _dio;
  
  void setBaseUrl(String url) {
    _dio.options.baseUrl = url;
  }
}
