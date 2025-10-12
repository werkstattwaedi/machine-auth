#pragma once

#include "common.h"

namespace oww::state {

struct Pending {};

template <typename TResponse>
using CloudResponse = std::variant<Pending, TResponse, ErrorType>;

template <typename TResponse>
bool IsSuccess(const CloudResponse<TResponse>& response) {
  return std::holds_alternative<TResponse>(response);
}

template <typename TResponse>
bool IsPending(const CloudResponse<TResponse>& response) {
  return std::holds_alternative<Pending>(response);
}

}  // namespace oww::state