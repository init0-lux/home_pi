import 'package:dio/dio.dart';
import '../error/exceptions.dart';

class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (err.type == DioExceptionType.connectionTimeout || 
        err.type == DioExceptionType.receiveTimeout || 
        err.type == DioExceptionType.connectionError) {
      throw NetworkException(err.message ?? 'Network error occurred');
    }
    
    if (err.response != null) {
      throw ServerException(
        err.response?.data?['message'] ?? 'Server error ${err.response?.statusCode}',
      );
    }
    
    return handler.next(err);
  }
}
