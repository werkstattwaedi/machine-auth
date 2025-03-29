all : byte_array_test
	./byte_array_test

byte_array_test : byte_array_test.cpp ../src/common/byte_array.h  libwiringgcc
	gcc byte_array_test.cpp UnitTestLib/libwiringgcc.a -std=c++17 -lstdc++ -IUnitTestLib -I../src -o byte_array_test

libwiringgcc :
	cd UnitTestLib && make libwiringgcc.a 	
	
.PHONY: libwiringgcc