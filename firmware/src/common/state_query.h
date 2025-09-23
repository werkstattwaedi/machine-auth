#pragma once

#include "common/state_machine.h"

namespace oww::common {

template <typename... States>
class StateQuery {
 public:
  using State = std::variant<States...>;
  using QueryFn = std::function<bool(const State&)>;

  constexpr StateQuery(QueryFn fn) : fn_(fn) {}

  bool Matches(const StateMachine<States...>& sm) const {
    return fn_(sm.GetState());
  }

  bool Matches(std::shared_ptr<StateMachine<States...>> sm) const {
    return fn_(sm->GetState());
  }

  bool Matches(const StateHandle<States...>& handle) const {
    if (auto sm = handle.state_machine_.lock()) {
      return fn_(sm->GetState());
    }
    return false;
  }

 private:
  QueryFn fn_;
};

}  // namespace oww::common
